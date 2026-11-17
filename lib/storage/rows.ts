import { stageCompetitionId, type StoredCompetition } from '../competition-record';
import {
  resultKey,
  type Assignment,
  type Audit,
  type Board,
  type BridgeEvent,
  type Participant,
  type Projection,
  type Result,
  type StoredEvent,
} from '../model';
import { canonical, type ResultWrites } from './cell-write';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';

const splitKeys = ['participants', 'assignments', 'boards', 'results', 'penalties', 'audit'] as const;

export type LoadedStage = {
  stored: StoredEvent;
  writes: ResultWrites;
  revisions: Record<string, number>;
};

export type StagePrior = {
  eventRevision: number;
  writes: ResultWrites;
  revisions: Record<string, number>;
  results: Record<string, Result>;
};

type StageRow = { id?: string; revision: unknown; settings: BridgeEvent; projection: Projection };

export function boardJson(board: Board) {
  return JSON.stringify(board);
}

export async function saveStage(
  sql: Sql,
  stored: StoredEvent,
  writes: ResultWrites,
  prior?: StagePrior,
) {
  const cap = captureSql();
  queueStage(cap.sql, stored, writes, prior);
  await commitSql(sql, cap.batches);
}

export function queueStage(sql: Sql, stored: StoredEvent, writes: ResultWrites, prior?: StagePrior) {
  const event = stored.event;
  const settings = { ...event } as Partial<BridgeEvent>;
  for (const key of splitKeys) delete settings[key];
  if (!prior)
    sql`INSERT INTO bridge_stages (id, revision, competition_id, settings, projection, updated_at)
      VALUES (${event.id}, ${event.revision}, ${stageCompetitionId(event)}, ${JSON.stringify(settings)}::jsonb, ${JSON.stringify(stored.projection)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, competition_id = EXCLUDED.competition_id,
        settings = EXCLUDED.settings, projection = EXCLUDED.projection, updated_at = now()`;
  else {
    sql`WITH upd AS (
      UPDATE bridge_stages SET revision = ${event.revision}, competition_id = ${stageCompetitionId(event)},
        settings = ${JSON.stringify(settings)}::jsonb, projection = ${JSON.stringify(stored.projection)}::jsonb, updated_at = now()
      WHERE id = ${event.id} AND revision = ${prior.eventRevision}
      RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM upd)`;
  }
  sql`DELETE FROM bridge_participants WHERE event_id = ${event.id}`;
  if (event.participants.length)
    sql`INSERT INTO bridge_participants (event_id, participant_id, ordinal, document)
      SELECT ${event.id}, document->>'id', ordinal, document
      FROM jsonb_to_recordset(${JSON.stringify(event.participants.map((document, ordinal) => ({ ordinal, document })))}::jsonb)
        AS x(ordinal int, document jsonb)`;
  sql`DELETE FROM bridge_assignments WHERE event_id = ${event.id}`;
  if (event.assignments.length)
    sql`INSERT INTO bridge_assignments (event_id, assignment_id, ordinal, document)
      SELECT ${event.id}, document->>'id', ordinal, document
      FROM jsonb_to_recordset(${JSON.stringify(event.assignments.map((document, ordinal) => ({ ordinal, document })))}::jsonb)
        AS x(ordinal int, document jsonb)`;
  sql`DELETE FROM bridge_boards WHERE event_id = ${event.id}`;
  if (event.boards.length)
    sql`INSERT INTO bridge_boards (event_id, board_number, ordinal, document_json)
      SELECT ${event.id}, board_number, ordinal, document_json
      FROM jsonb_to_recordset(${JSON.stringify(event.boards.map((document, ordinal) => ({ ordinal, board_number: document.number, document_json: boardJson(document) })))}::jsonb)
        AS x(board_number int, ordinal int, document_json text)`;
  queueResults(sql, event, writes, prior);
  sql`DELETE FROM bridge_penalties WHERE event_id = ${event.id}`;
  const penalties = Object.entries(event.penalties ?? {});
  if (penalties.length)
    sql`INSERT INTO bridge_penalties (event_id, participant_id, amount)
      SELECT ${event.id}, participant_id, amount
      FROM jsonb_to_recordset(${JSON.stringify(penalties.map(([participant_id, amount]) => ({ participant_id, amount })))}::jsonb)
        AS x(participant_id text, amount jsonb)`;
  sql`DELETE FROM bridge_audit WHERE event_id = ${event.id}`;
  if (event.audit.length)
    sql`INSERT INTO bridge_audit (event_id, seq, document)
      SELECT ${event.id}, seq, document
      FROM jsonb_to_recordset(${JSON.stringify(event.audit.map((document, seq) => ({ seq, document })))}::jsonb)
        AS x(seq int, document jsonb)`;
  const requestIds = JSON.stringify(stored.requests);
  sql`DELETE FROM bridge_requests WHERE event_id = ${event.id}
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${requestIds}::jsonb) AS ids(value) WHERE ids.value = bridge_requests.request_id)`;
  if (stored.requests.length)
    sql`INSERT INTO bridge_requests (event_id, request_id)
      SELECT ${event.id}, value FROM jsonb_array_elements_text(${requestIds}::jsonb)
      ON CONFLICT DO NOTHING`;
}

function queueResults(sql: Sql, event: BridgeEvent, writes: ResultWrites, prior?: StagePrior) {
  if (!prior) {
    sql`DELETE FROM bridge_results WHERE event_id = ${event.id}`;
    const rows = Object.values(event.results);
    if (rows.length)
      sql`INSERT INTO bridge_results (event_id, assignment_id, board, revision, written_at_event_revision, document)
        SELECT ${event.id}, assignment_id, board, 1, written_at, document
        FROM jsonb_to_recordset(${JSON.stringify(rows.map((document) => ({
          assignment_id: document.assignmentId,
          board: document.board,
          written_at: writes[resultKey(document.assignmentId, document.board)] ?? event.revision,
          document,
        })))}::jsonb) AS x(assignment_id text, board int, written_at int, document jsonb)`;
    return;
  }
  const seen = new Set<string>();
  for (const result of Object.values(event.results)) {
    const key = resultKey(result.assignmentId, result.board);
    seen.add(key);
    const writtenAt = writes[key] ?? event.revision;
    const previous = prior.revisions[key];
    if (!previous) {
      sql`INSERT INTO bridge_results (event_id, assignment_id, board, revision, written_at_event_revision, document)
        VALUES (${event.id}, ${result.assignmentId}, ${result.board}, 1, ${writtenAt}, ${JSON.stringify(result)}::jsonb)`;
      continue;
    }
    if (
      canonical(prior.results[key]) === canonical(result) &&
      prior.writes[key] === writtenAt
    )
      continue;
    const expected = prior.writes[key] ?? 0;
    sql`WITH upd AS (
      UPDATE bridge_results SET revision = revision + 1, written_at_event_revision = ${writtenAt},
        document = ${JSON.stringify(result)}::jsonb
      WHERE event_id = ${event.id} AND assignment_id = ${result.assignmentId} AND board = ${result.board}
        AND written_at_event_revision = ${expected}
      RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM upd)`;
  }
  for (const key of Object.keys(prior.revisions)) {
    if (seen.has(key)) continue;
    const splitAt = key.lastIndexOf(':');
    const assignmentId = key.slice(0, splitAt);
    const board = Number(key.slice(splitAt + 1));
    const expected = prior.writes[key] ?? 0;
    sql`WITH del AS (
      DELETE FROM bridge_results WHERE event_id = ${event.id} AND assignment_id = ${assignmentId} AND board = ${board}
        AND written_at_event_revision = ${expected}
      RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM del)`;
  }
}

export async function loadStage(sql: Sql, id: string): Promise<LoadedStage | null> {
  const rows = await sql`SELECT id, revision, settings, projection FROM bridge_stages WHERE id = ${id}`;
  if (!rows.length) return null;
  const [loaded] = await hydrateStages(sql, rows as unknown as StageRow[]);
  return loaded ?? null;
}

export async function loadStages(sql: Sql): Promise<LoadedStage[]> {
  const rows =
    await sql`SELECT id, revision, settings, projection FROM bridge_stages ORDER BY updated_at DESC, id`;
  return hydrateStages(sql, rows as unknown as StageRow[]);
}

async function hydrateStages(sql: Sql, stages: StageRow[]): Promise<LoadedStage[]> {
  if (!stages.length) return [];
  const [participants, assignments, boards, results, penalties, audits, requests] = await Promise.all([
    sql`SELECT event_id, ordinal, document FROM bridge_participants ORDER BY event_id, ordinal`,
    sql`SELECT event_id, ordinal, document FROM bridge_assignments ORDER BY event_id, ordinal`,
    sql`SELECT event_id, ordinal, document_json FROM bridge_boards ORDER BY event_id, ordinal`,
    sql`SELECT event_id, assignment_id, board, revision, written_at_event_revision, document FROM bridge_results ORDER BY event_id, assignment_id, board`,
    sql`SELECT event_id, participant_id, amount FROM bridge_penalties ORDER BY event_id, participant_id`,
    sql`SELECT event_id, seq, document FROM bridge_audit ORDER BY event_id, seq`,
    sql`SELECT event_id, request_id FROM bridge_requests ORDER BY event_id, created_at, request_id`,
  ]);
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
    const settings = stage.settings;
    const event: BridgeEvent = {
      ...settings,
      id: String(stage.id ?? settings.id),
      revision: Number(stage.revision),
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
    const writes: ResultWrites = {};
    const revisions: Record<string, number> = {};
    for (const row of resultRows.get(id) ?? []) {
      const typed = row as unknown as { document: Result; written_at_event_revision: unknown; revision: unknown };
      const key = resultKey(typed.document.assignmentId, typed.document.board);
      writes[key] = Number(typed.written_at_event_revision);
      revisions[key] = Number(typed.revision);
    }
    return {
      stored: {
        event,
        projection: stage.projection,
        requests: (requestRows.get(id) ?? []).map((row) => String((row as unknown as { request_id: string }).request_id)),
      },
      writes,
      revisions,
    };
  });
}

export function queueDeleteStage(sql: Sql, id: string, revision?: number) {
  if (revision === undefined) sql`DELETE FROM bridge_stages WHERE id = ${id}`;
  else
    sql`WITH del AS (
      DELETE FROM bridge_stages WHERE id = ${id} AND revision = ${revision} RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM del)`;
  sql`DELETE FROM bridge_participants WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_assignments WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_boards WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_results WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_penalties WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_audit WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_requests WHERE event_id = ${id}`;
}

export async function deleteStageRows(sql: Sql, id: string) {
  const cap = captureSql();
  queueDeleteStage(cap.sql, id);
  await commitSql(sql, cap.batches);
}

export function queueCompetition(sql: Sql, stored: StoredCompetition, expectedRevision?: number) {
  const { audit, ...document } = stored.competition;
  if (expectedRevision === undefined)
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
  sql`DELETE FROM bridge_competition_audit WHERE competition_id = ${stored.competition.id}`;
  if (audit.length)
    sql`INSERT INTO bridge_competition_audit (competition_id, seq, document)
      SELECT ${stored.competition.id}, seq, document
      FROM jsonb_to_recordset(${JSON.stringify(audit.map((entry, seq) => ({ seq, document: entry })))}::jsonb)
        AS x(seq int, document jsonb)`;
  const requestIds = JSON.stringify(stored.requests);
  sql`DELETE FROM bridge_competition_requests WHERE competition_id = ${stored.competition.id}
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${requestIds}::jsonb) AS ids(value) WHERE ids.value = bridge_competition_requests.request_id)`;
  if (stored.requests.length)
    sql`INSERT INTO bridge_competition_requests (competition_id, request_id)
      SELECT ${stored.competition.id}, value FROM jsonb_array_elements_text(${requestIds}::jsonb)
      ON CONFLICT DO NOTHING`;
}

export async function saveCompetition(sql: Sql, stored: StoredCompetition, expectedRevision?: number) {
  const cap = captureSql();
  queueCompetition(cap.sql, stored, expectedRevision);
  await commitSql(sql, cap.batches);
}

export async function loadCompetitions(sql: Sql): Promise<StoredCompetition[]> {
  const rows = await sql`SELECT id, revision, document FROM bridge_competitions ORDER BY id`;
  if (!rows.length) return [];
  const [audits, requests] = await Promise.all([
    sql`SELECT competition_id, seq, document FROM bridge_competition_audit ORDER BY competition_id, seq`,
    sql`SELECT competition_id, request_id FROM bridge_competition_requests ORDER BY competition_id, created_at, request_id`,
  ]);
  return rows.map((row) => {
    const id = String(row.id);
    const document = row.document as StoredCompetition['competition'];
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
