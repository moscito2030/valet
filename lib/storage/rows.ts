import { knockoutExemptAssignments } from '../knockout-status';
import { materializeBoardPublication } from '../board-publication';
import { boardsStillInPlay } from '../board-in-play';
import { audienceScoring } from '../read-models/public-event';
import { queuePublicSnapshot } from './projection';
import { DomainError } from '../domain-error';
import { clubConfirmationKey } from '../club-confirmation';
import { interleavedSize } from '../team-movement';
import { tableDeviceKey, tableDevices } from '../table-device';
import { stageCompetitionId, type StoredCompetition } from '../competition-record';
import {
  resultKey,
  type Assignment,
  type Audit,
  type Board,
  type BridgeEvent,
  type Participant,
  type Result,
  type Mutation,
  type StoredEvent,
} from '../model';
import { storedWithProjection } from '../scoring';
import { canonical, type ResultWrites } from './cell-write';
import { captureSql, commitSql, queueDataVersion } from './batch';
import type { Sql } from './neon';

const splitKeys = ['participants', 'assignments', 'boards', 'results', 'penalties', 'audit'] as const;

export type LoadedStage = {
  stored: StoredEvent;
  stageVersion: number;
  publicVersion: number | null;
  assignmentVersions: Record<string, number>;
  penaltyVersions: Record<string, number>;
};

type StageRow = { id?: string; revision: unknown; public_version: number | null; settings: BridgeEvent; updated_at: string };

export function boardJson(board: Board) {
  return JSON.stringify(board);
}

export async function saveStage(
  sql: Sql,
  stored: StoredEvent,
  writes: ResultWrites,
  prior?: LoadedStage,
) {
  const cap = captureSql();
  queueStage(cap.sql, stored, writes, prior);
  await commitSql(sql, cap.batches);
}

export function queueStage(sql: Sql, stored: StoredEvent, writes: ResultWrites, prior?: LoadedStage, command?: Mutation) {
  const event = stored.event;
  const before = prior?.stored.event;
  const settings = stageSettings(event);
  const clientRevision = command?.revision;
  let stageChanged = !prior;
  queueDataVersion(sql, event.id);
  if (!prior) {
    sql`INSERT INTO bridge_stages (id, revision, competition_id, settings, projection, updated_at)
      VALUES (${event.id}, current_setting('valet.data_version')::int, ${stageCompetitionId(event)}, ${JSON.stringify(settings)}::jsonb, '{}'::jsonb, ${event.updatedAt})`;
  } else {
    const settingsChanged = canonical(settings) !== canonical(stageSettings(prior.stored.event));
    const tableCommand = command && (['results', 'clear-result', 'adjusted-score', 'ruling', 'split-contract',
      'table-lineup', 'club-play', 'club-complete-table', 'penalty'].includes(command.action) ||
      (command.action === 'club-config' && command.assignmentId !== undefined));
    stageChanged = !tableCommand || settingsChanged ||
      canonical(before!.participants) !== canonical(event.participants) ||
      canonical(before!.boards) !== canonical(event.boards) ||
      canonical(before!.club?.tokens) !== canonical(event.club?.tokens) ||
      canonical(before!.assignments.map(a => a.id)) !== canonical(event.assignments.map(a => a.id));
    if (stageChanged) {
      rejectStale(prior.stageVersion, clientRevision);
      const maxAssignment = Math.max(0, ...Object.values(prior.assignmentVersions));
      sql`WITH upd AS (UPDATE bridge_stages SET revision = current_setting('valet.data_version')::int,
        competition_id = ${stageCompetitionId(event)}, updated_at = ${event.updatedAt}
        WHERE id = ${event.id} AND revision = ${prior.stageVersion} AND
        (SELECT coalesce(max(version),0) FROM bridge_assignments WHERE event_id = ${event.id}) = ${maxAssignment}
        RETURNING 1) SELECT 1 / (SELECT count(*)::int FROM upd)`;
      if (settingsChanged) sql`UPDATE bridge_stages SET settings = ${JSON.stringify(settings)}::jsonb WHERE id = ${event.id}`;
    }
  }
  if (event.organizerId !== before?.organizerId || (before && stageCompetitionId(before) !== stageCompetitionId(event))) {
    queueCompetitionOrganizer(sql, stageCompetitionId(event));
    if (before && stageCompetitionId(before) !== stageCompetitionId(event))
      queueCompetitionOrganizer(sql, stageCompetitionId(before));
  }
  if (prior && command && !stageChanged) {
    const tables = command.action === 'results' ? command.results.map(r => r.assignmentId)
      : 'assignmentId' in command && command.assignmentId ? [command.assignmentId] : [];
    for (const id of tables) rejectStale(prior.assignmentVersions[id] ?? 0, clientRevision);
  }
  for (const row of before?.participants ?? [])
    if (!event.participants.some(p => p.id === row.id))
      sql`DELETE FROM bridge_participants WHERE event_id = ${event.id} AND participant_id = ${row.id}`;
  for (const [ordinal, row] of event.participants.entries()) {
    if (canonical(row) === canonical(before?.participants[ordinal])) continue;
    sql`INSERT INTO bridge_participants(event_id, participant_id, ordinal, document)
      VALUES (${event.id}, ${row.id}, ${ordinal}, ${JSON.stringify(row)}::jsonb)
      ON CONFLICT(event_id, participant_id) DO UPDATE SET ordinal = excluded.ordinal, document = excluded.document`;
  }
  for (const row of before?.assignments ?? [])
    if (!event.assignments.some(a => a.id === row.id))
      sql`DELETE FROM bridge_assignments WHERE event_id = ${event.id} AND assignment_id = ${row.id}`;
  const changedCells = [...new Set([...Object.keys(before?.results ?? {}), ...Object.keys(event.results)])]
    .filter(key => canonical(before?.results[key]) !== canonical(event.results[key]));
  const changedResults = new Set(changedCells.map(key => (event.results[key] ?? before!.results[key]).assignmentId));
  if (prior && changedCells.length && !stageChanged) {
    // Publication settings may have changed since this table was read.
    sql`SELECT 1 / count(*)::int FROM bridge_stages WHERE id = ${event.id} AND revision = ${prior.stageVersion}`;
    if (!event.club?.enabled) {
      // In director scoring the last result from another table can release the same board.
      const boards = new Set(changedCells.map(key => (event.results[key] ?? before!.results[key]).board));
      const peers = event.assignments.filter(a => !changedResults.has(a.id) && a.boards.some(b => boards.has(b)));
      if (peers.length) sql`SELECT 1 / (NOT EXISTS (SELECT 1 FROM bridge_assignments WHERE event_id = ${event.id}
        AND assignment_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(peers.map(a => a.id))}::jsonb))
        AND version > ${before!.revision}))::int`;
    }
  }
  const exempt = knockoutExemptAssignments(event);
  const oldExempt = before && knockoutExemptAssignments(before);
  // A round switch or a deletion changes progress even when the surviving schedules are identical.
  const progressChanged = before && (before.currentRound !== event.currentRound ||
    before.assignments.some(a => !event.assignments.some(next => next.id === a.id)));
  for (const [ordinal, row] of event.assignments.entries()) {
    const device = tableDeviceKey(event, row);
    const confirmation = event.club?.confirmations[clubConfirmationKey(event, row)];
    const old = before?.assignments[ordinal];
    const override = event.club?.inputOverrides?.[row.id];
    const unchanged = old && before && canonical(row) === canonical(old) &&
      override === before.club?.inputOverrides?.[row.id] && device === tableDeviceKey(before, old) &&
      exempt.has(row.id) === oldExempt!.has(row.id) &&
      !!event.provisionalVp?.[row.matchId] === !!before.provisionalVp?.[row.matchId] &&
      canonical(confirmation) === canonical(before.club?.confirmations[clubConfirmationKey(before, old)]);
    if (unchanged && !changedResults.has(row.id) && !(ordinal === 0 && progressChanged)) continue;
    if (prior && prior.assignmentVersions[row.id] !== undefined) {
      const version = prior.assignmentVersions[row.id];
      if (!stageChanged) rejectStale(version, clientRevision);
      sql`SELECT 1 / count(*)::int FROM (SELECT 1 FROM bridge_assignments WHERE event_id = ${event.id}
        AND assignment_id = ${row.id} AND version = ${version} FOR UPDATE) guard`;
    }
    if (unchanged) {
      sql`UPDATE bridge_assignments SET version = current_setting('valet.data_version')::bigint
        WHERE event_id = ${event.id} AND assignment_id = ${row.id}`;
      continue;
    }
    sql`INSERT INTO bridge_assignments(event_id, assignment_id, ordinal, document, round, table_label, room, ns, ew, device_key, input_pair, exempt, provisional, version, confirmation)
      VALUES (${event.id}, ${row.id}, ${ordinal}, ${JSON.stringify(row)}::jsonb, ${row.round}, ${String(row.table)},
        ${row.room}, ${row.ns}, ${row.ew}, ${device}, ${override ?? null}, ${exempt.has(row.id)}, ${!!event.provisionalVp?.[row.matchId]}, current_setting('valet.data_version')::bigint, ${confirmation ? JSON.stringify(confirmation) : null}::jsonb)
      ON CONFLICT(event_id, assignment_id) DO UPDATE SET ordinal = excluded.ordinal, document = excluded.document,
        round = excluded.round, table_label = excluded.table_label, room = excluded.room, ns = excluded.ns, ew = excluded.ew,
        device_key = excluded.device_key, input_pair = excluded.input_pair, exempt = excluded.exempt, provisional = excluded.provisional, version = excluded.version, confirmation = excluded.confirmation`;
  }
  for (const row of before?.boards ?? [])
    if (!event.boards.some(b => b.number === row.number))
      sql`DELETE FROM bridge_boards WHERE event_id = ${event.id} AND board_number = ${row.number}`;
  for (const [ordinal, row] of event.boards.entries()) {
    if (canonical(row) === canonical(before?.boards[ordinal])) continue;
    sql`INSERT INTO bridge_boards(event_id, board_number, ordinal, document_json)
      VALUES (${event.id}, ${row.number}, ${ordinal}, ${boardJson(row)})
      ON CONFLICT(event_id, board_number) DO UPDATE SET ordinal = excluded.ordinal, document_json = excluded.document_json`;
  }
  for (const key of changedCells) {
    const result = event.results[key];
    if (result) {
      sql`INSERT INTO bridge_results(event_id, assignment_id, board, revision, written_at_event_revision, document)
        VALUES (${event.id}, ${result.assignmentId}, ${result.board}, 1,
          coalesce(${prior ? null : writes[key] ?? null}::int, current_setting('valet.data_version')::int), ${JSON.stringify(result)}::jsonb)
        ON CONFLICT(event_id, assignment_id, board) DO UPDATE SET revision = bridge_results.revision + 1,
          written_at_event_revision = excluded.written_at_event_revision, document = excluded.document`;
    } else {
      const old = before!.results[key];
      sql`DELETE FROM bridge_results WHERE event_id = ${event.id} AND assignment_id = ${old.assignmentId} AND board = ${old.board}`;
    }
  }
  for (const key of Object.keys(before?.penalties ?? {}))
    if (!(key in (event.penalties ?? {})))
      sql`DELETE FROM bridge_penalties WHERE event_id = ${event.id} AND participant_id = ${key}`;
  for (const [key, amount] of Object.entries(event.penalties ?? {})) {
    const previous = prior?.penaltyVersions[key];
    if (command?.action === 'penalty' && command.participantId === key) rejectStale(previous ?? 0, clientRevision);
    if (before?.penalties?.[key] === amount) continue;
    if (previous === undefined)
      sql`INSERT INTO bridge_penalties(event_id, participant_id, amount, version)
        VALUES (${event.id}, ${key}, ${JSON.stringify(amount)}::jsonb, current_setting('valet.data_version')::bigint)`;
    else
      sql`WITH upd AS (UPDATE bridge_penalties SET amount = ${JSON.stringify(amount)}::jsonb, version = current_setting('valet.data_version')::bigint
        WHERE event_id = ${event.id} AND participant_id = ${key} AND version = ${previous} RETURNING 1)
        SELECT 1 / (SELECT count(*)::int FROM upd)`;
  }
  for (const key of Object.keys(before?.club?.tokens ?? {}))
    if (!(key in (event.club?.tokens ?? {})))
      sql`DELETE FROM bridge_club_tokens WHERE event_id = ${event.id} AND device_key = ${key}`;
  const devices = new Map(tableDevices(event).map(d => [d.key, d.label]));
  const oldDevices = new Map(before && tableDevices(before).map(d => [d.key, d.label] as const));
  const size = interleavedSize(event), oldSize = before && interleavedSize(before);
  for (const [key, hash] of Object.entries(event.club?.tokens ?? {})) {
    if (before?.club?.tokens[key] === hash && oldSize === size && oldDevices.get(key) === devices.get(key)) continue;
    sql`INSERT INTO bridge_club_tokens(event_id, device_key, token_hash, movement_size, device_label)
      VALUES (${event.id}, ${key}, ${hash}, ${size}, ${devices.get(key) ?? null})
      ON CONFLICT(event_id, device_key) DO UPDATE SET token_hash = excluded.token_hash, movement_size = excluded.movement_size, device_label = excluded.device_label`;
  }
  function visibleScoresChanged() {
    if (!changedCells.length || !before) return false;
    const waiting = boardsStillInPlay(event);
    const previous = event.club?.enabled ? waiting : boardsStillInPlay(before);
    const published = new Set(materializeBoardPublication(event).boards.filter(b => b.published).map(b => b.number));
    if (changedCells.some(key => {
      const board = (event.results[key] ?? before.results[key]).board;
      return published.has(board) && (!waiting.has(board) || !previous.has(board));
    })) return true;
    return !event.club?.enabled && !!event.provisionalVp &&
      canonical(audienceScoring(materializeBoardPublication(before)).provisionalVp) !==
      canonical(audienceScoring(materializeBoardPublication(event)).provisionalVp);
  }
  const publicChanged = stageChanged || canonical(before?.penalties) !== canonical(event.penalties) ||
    canonical(before?.assignments) !== canonical(event.assignments) ||
    visibleScoresChanged();
  if (publicChanged) queuePublicSnapshot(sql, event, prior?.publicVersion ?? null);
  if (command)
    sql`SELECT set_config('valet.data_version', greatest(revision,
      (SELECT max(version) FROM bridge_assignments WHERE event_id = ${event.id}),
      (SELECT max(version) FROM bridge_penalties WHERE event_id = ${event.id}))::text, true) AS data_version
      FROM bridge_stages WHERE id = ${event.id}`;
  for (const audit of event.audit.slice(before?.audit.length ?? 0))
    if (prior)
      sql`INSERT INTO bridge_audit(event_id, seq, document) VALUES (${event.id}, nextval('bridge_data_version'),
        jsonb_set(${JSON.stringify(audit)}::jsonb, '{revision}', to_jsonb(current_setting('valet.data_version')::bigint)))`;
    else sql`INSERT INTO bridge_audit(event_id, seq, document) VALUES (${event.id}, nextval('bridge_data_version'), ${JSON.stringify(audit)}::jsonb)`;
  for (const [offset, request] of stored.requests.slice(prior?.stored.requests.length ?? 0).entries()) {
    const ordinal = (prior?.stored.requests.length ?? 0) + offset;
    sql`INSERT INTO bridge_requests(event_id, request_id, ordinal) VALUES (${event.id}, ${request}, ${ordinal})`;
  }
}

function rejectStale(version: number, clientRevision?: number) {
  if (clientRevision !== undefined && version > clientRevision)
    throw new DomainError('賽段版本已更新，請重新載入後再提交。', 409, 'stage-revision');
}

function stageSettings(event: BridgeEvent) {
  const { prefix: _legacyPrefix, club, ...settings }: Partial<BridgeEvent> & { prefix?: unknown } = event;
  for (const key of splitKeys) delete settings[key];
  delete settings.revision;
  delete settings.updatedAt;
  if (!club) return settings;
  const { confirmations: _confirmations, tokens: _tokens, inputOverrides: _overrides, ...collection } = club;
  return { ...settings, club: collection };
}

export async function loadStage(sql: Sql, id: string, history = true): Promise<LoadedStage | null> {
  const cap = captureSql();
  cap.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
  cap.sql`SELECT id, revision, public_version, settings, updated_at FROM bridge_stages WHERE id = ${id}`;
  queueChildren(cap.sql, JSON.stringify([id]), history);
  const [, stages, ...children] = await commitSql(sql, cap.batches);
  return hydrateStages(stages as unknown as StageRow[], children, history)[0] ?? null;
}

export async function loadStages(sql: Sql, competitionId?: string): Promise<LoadedStage[]> {
  const rows = competitionId === undefined
    ? await sql`SELECT id, revision, public_version, settings, updated_at FROM bridge_stages ORDER BY updated_at DESC, id`
    : await sql`SELECT id, revision, public_version, settings, updated_at FROM bridge_stages
        WHERE competition_id = ${competitionId} OR id = ${competitionId} ORDER BY updated_at DESC, id`;
  if (!rows.length) return [];
  const cap = captureSql();
  queueChildren(cap.sql, JSON.stringify(rows.map(row => row.id)), true);
  return hydrateStages(rows as unknown as StageRow[], await commitSql(sql, cap.batches), true);
}

function queueChildren(sql: Sql, ids: string, history: boolean) {
    sql`SELECT event_id, ordinal, document FROM bridge_participants WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY event_id, ordinal`;
    sql`SELECT event_id, ordinal, document, confirmation, input_pair, assignment_id, version FROM bridge_assignments WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY event_id, ordinal`;
    sql`SELECT event_id, ordinal, document_json FROM bridge_boards WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY event_id, ordinal`;
    sql`SELECT event_id, document FROM bridge_results WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY event_id, assignment_id, board`;
    sql`SELECT event_id, participant_id, amount, version FROM bridge_penalties WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY event_id, participant_id`;
    if (history) sql`SELECT event_id, seq, document FROM bridge_audit WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY event_id, seq`;
    if (history) sql`SELECT event_id, request_id FROM bridge_requests WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY event_id, ordinal, request_id`;
    sql`SELECT event_id, device_key, token_hash FROM bridge_club_tokens WHERE event_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb))`;
}

function hydrateStages(stages: StageRow[], children: Record<string, unknown>[][], history: boolean): LoadedStage[] {
  const [participants, assignments, boards, results, penalties] = children;
  const audits = history ? children[5] : [], requests = history ? children[6] : [];
  const tokens = children.at(-1)!;
  const group = <T extends { event_id: unknown }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const id = String(row.event_id);
      map.set(id, [...(map.get(id) ?? []), row]);
    }
    return map;
  };
  const participantRows = group(participants as { event_id: unknown }[]);
  const assignmentRows = group(assignments as { event_id: unknown }[]);
  const boardRows = group(boards as { event_id: unknown }[]);
  const resultRows = group(results as { event_id: unknown }[]);
  const penaltyRows = group(penalties as { event_id: unknown }[]);
  const auditRows = group(audits as { event_id: unknown }[]);
  const requestRows = group(requests as { event_id: unknown }[]);
  return stages.map((stage) => {
    const id = String(stage.id);
    const { prefix: _legacyPrefix, ...settings } = stage.settings as BridgeEvent & { prefix?: unknown };
    const assignmentVersions = Object.fromEntries(assignments.filter(r => r.event_id === id).map(r => [String(r.assignment_id), Number(r.version)]));
    const penaltyVersions = Object.fromEntries(penalties.filter(r => r.event_id === id).map(r => [String(r.participant_id), Number(r.version)]));
    const event: BridgeEvent = {
      ...settings,
      id: String(stage.id ?? settings.id),
      updatedAt: settings.updatedAt ?? new Date(stage.updated_at).toISOString(),
      revision: Math.max(Number(stage.revision), ...Object.values(assignmentVersions), ...Object.values(penaltyVersions)),
      participants: (participantRows.get(id) ?? []).map((row) => (row as unknown as { document: Participant }).document),
      assignments: (assignmentRows.get(id) ?? []).map((row) => (row as unknown as { document: Assignment }).document),
      boards: (boardRows.get(id) ?? []).map((row) => JSON.parse(String((row as unknown as { document_json: string }).document_json)) as Board),
      results: Object.fromEntries(
        (resultRows.get(id) ?? []).map((row) => {
          const result = (row as unknown as { document: Result }).document;
          return [resultKey(result.assignmentId, result.board), result];
        }),
      ),
      penalties: Object.fromEntries(
        (penaltyRows.get(id) ?? []).map((row) => {
          const typed = row as unknown as { participant_id: string; amount: number };
          return [typed.participant_id, typed.amount];
        }),
      ),
      audit: (auditRows.get(id) ?? []).map((row) => (row as unknown as { document: Audit }).document),
    };
    if (event.club) {
      const overrides = assignments.filter(row => row.event_id === id && row.input_pair);
      const hadOverrides = event.club.inputOverrides !== undefined;
      delete event.club.inputOverrides;
      if (hadOverrides || overrides.length) event.club.inputOverrides = Object.fromEntries(overrides.map(r => [String(r.assignment_id), String(r.input_pair)]));
      const confirmations: typeof event.club.confirmations = {};
      for (const row of assignments.filter(row => row.event_id === id && row.confirmation)) {
        confirmations[clubConfirmationKey(event, row.document as Assignment)] =
          row.confirmation as (typeof confirmations)[string];
      }
      event.club = { ...event.club, confirmations,
        tokens: Object.fromEntries(tokens.filter(row => row.event_id === id).map(row => [String(row.device_key), String(row.token_hash)])),
      };
    }
    return {
      stageVersion: Number(stage.revision), publicVersion: stage.public_version == null ? null : Number(stage.public_version), assignmentVersions, penaltyVersions,
      stored: storedWithProjection(event, (requestRows.get(id) ?? []).map(row => String((row as unknown as { request_id: string }).request_id))),
    };
  });
}

export function queueCompetitionOrganizer(sql: Sql, competitionId: string) {
  sql`UPDATE bridge_competitions SET organizer_id = (
    SELECT min(organizer_id) FROM bridge_stages WHERE competition_id = ${competitionId}
      AND btrim(organizer_id) <> '' HAVING count(DISTINCT organizer_id) = 1
    ) WHERE id = ${competitionId}`;
}

export function queueDeleteStage(sql: Sql, id: string, revision?: number) {
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  if (revision === undefined) sql`DELETE FROM bridge_stages WHERE id = ${id}`;
  else
    sql`WITH del AS (
      DELETE FROM bridge_stages WHERE id = ${id} AND greatest(revision,
        (SELECT max(version) FROM bridge_assignments WHERE event_id = ${id}),
        (SELECT max(version) FROM bridge_penalties WHERE event_id = ${id})) = ${revision} RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM del)`;
  sql`DELETE FROM bridge_participants WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_assignments WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_boards WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_results WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_penalties WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_club_tokens WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_projection_cache WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_audit WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_requests WHERE event_id = ${id}`;
}

export async function deleteStageRows(sql: Sql, id: string) {
  const cap = captureSql();
  queueDeleteStage(cap.sql, id);
  await commitSql(sql, cap.batches);
}

export function queueCompetition(sql: Sql, stored: StoredCompetition, expectedRevision?: number | null, insertOnly = false) {
  const { audit, prefix: _legacyPrefix, ...document } = stored.competition as StoredCompetition['competition'] & { prefix?: unknown };
  if (insertOnly || expectedRevision === null)
    sql`INSERT INTO bridge_competitions (id, revision, document, updated_at)
      VALUES (${stored.competition.id}, ${stored.competition.revision}, ${JSON.stringify(document)}::jsonb, now())`;
  else if (expectedRevision === undefined)
    sql`INSERT INTO bridge_competitions (id, revision, document, updated_at)
      VALUES (${stored.competition.id}, ${stored.competition.revision}, ${JSON.stringify(document)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, document = EXCLUDED.document, updated_at = now()`;
  else {
    sql`WITH upd AS (
      UPDATE bridge_competitions SET revision = ${stored.competition.revision}, document = ${JSON.stringify(document)}::jsonb, updated_at = now()
      WHERE id = ${stored.competition.id} AND revision = ${expectedRevision}
      RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM upd)`;
  }
  if (!insertOnly) sql`DELETE FROM bridge_competition_audit WHERE competition_id = ${stored.competition.id}`;
  if (audit.length)
    sql`INSERT INTO bridge_competition_audit (competition_id, seq, document)
      SELECT ${stored.competition.id}, seq, document
      FROM jsonb_to_recordset(${JSON.stringify(audit.map((entry, seq) => ({ seq, document: entry })))}::jsonb)
        AS x(seq int, document jsonb)`;
  const requestRows = JSON.stringify(stored.requests.map((request_id, ordinal) => ({ request_id, ordinal })));
  if (!insertOnly) sql`DELETE FROM bridge_competition_requests WHERE competition_id = ${stored.competition.id}
    AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(${requestRows}::jsonb) AS ids(request_id text, ordinal int) WHERE ids.request_id = bridge_competition_requests.request_id)`;
  if (stored.requests.length)
    sql`INSERT INTO bridge_competition_requests (competition_id, request_id, ordinal)
      SELECT ${stored.competition.id}, request_id, ordinal FROM jsonb_to_recordset(${requestRows}::jsonb) AS x(request_id text, ordinal int)
      ON CONFLICT (competition_id, request_id) DO UPDATE SET ordinal = EXCLUDED.ordinal`;
}

export async function saveCompetition(sql: Sql, stored: StoredCompetition, expectedRevision?: number) {
  const cap = captureSql();
  queueCompetition(cap.sql, stored, expectedRevision);
  await commitSql(sql, cap.batches);
}

export async function loadCompetitions(sql: Sql, competitionId?: string, history = true): Promise<StoredCompetition[]> {
  const rows = competitionId === undefined
    ? await sql`SELECT id, revision, document FROM bridge_competitions ORDER BY id`
    : await sql`SELECT id, revision, document FROM bridge_competitions WHERE id = ${competitionId}`;
  if (!rows.length) return [];
  const ids = JSON.stringify(rows.map((row) => String(row.id)));
  const [audits, requests] = await Promise.all([
    !history ? [] : sql`SELECT competition_id, seq, document FROM bridge_competition_audit WHERE competition_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY competition_id, seq`,
    !history ? [] : sql`SELECT competition_id, request_id FROM bridge_competition_requests WHERE competition_id IN (SELECT value FROM jsonb_array_elements_text(${ids}::jsonb)) ORDER BY competition_id, ordinal, request_id`,
  ]);
  return rows.map((row) => {
    const id = String(row.id);
    const { prefix: _legacyPrefix, ...document } = row.document as StoredCompetition['competition'] & { prefix?: unknown };
    return {
      competition: {
        ...document,
        revision: Number(row.revision),
        audit: audits
          .filter((entry) => entry.competition_id === id)
          .map((entry) => entry.document as StoredCompetition['competition']['audit'][number]),
      },
      requests: requests.filter((entry) => entry.competition_id === id).map((entry) => String(entry.request_id)),
    };
  });
}

export function queueDeleteCompetition(sql: Sql, id: string, revision?: number) {
  if (revision === undefined) sql`DELETE FROM bridge_competitions WHERE id = ${id}`;
  else
    sql`WITH del AS (
      DELETE FROM bridge_competitions WHERE id = ${id} AND revision = ${revision} RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM del)`;
  sql`DELETE FROM bridge_competition_audit WHERE competition_id = ${id}`;
  sql`DELETE FROM bridge_competition_requests WHERE competition_id = ${id}`;
  sql`DELETE FROM bridge_competition_redirects WHERE from_id = ${id} OR to_id = ${id}`;
}

export async function deleteCompetitionRows(sql: Sql, id: string) {
  const cap = captureSql();
  queueDeleteCompetition(cap.sql, id);
  await commitSql(sql, cap.batches);
}
