import { clubConfirmationKey } from '../club-confirmation';
import { knockoutLegs, knockoutMatchId } from '../knockout';
import { resultUpdatedAt, staleClubResult } from '../club-submit';
import { clubView, type ClubView } from '../club-view';
import { DomainError } from '../domain-error';
import {
  resultKey,
  type Assignment,
  type Board,
  type BridgeEvent,
  type Mutation,
  type Participant,
  type Result,
} from '../model';
import { applyCollectionCommand } from '../mutations/collection';
import type { MutationContext } from '../mutations/context';
import { normalizeResults } from '../result-status';
import { clubRoundReady, nextScheduledRound } from '../round-workflow';
import { roundLabel, type InterleavedSize } from '../team-movement';
import { captureSql, commitSql, isConflict, queueDataVersion } from './batch';
import type { Sql } from './neon';
import { assertNormalizedMode, missingStorage } from './switch';

async function tabletHead(sql: Sql, id: string, hash: string, director: boolean) {
  const [row] =
    await sql`SELECT sw.mode, sw.per_table_at, s.id, s.revision, s.current_round, s.club_enabled,
      s.archived OR c.archived AS archived, t.device_key, t.movement_size, t.device_label, a.assignment_id, a.version
    FROM bridge_storage_switch sw
    LEFT JOIN bridge_stages s ON s.id = ${id}
    LEFT JOIN bridge_competitions c ON c.id = s.competition_id
    LEFT JOIN bridge_club_tokens t ON t.event_id = s.id AND t.token_hash = ${hash}
    LEFT JOIN LATERAL (SELECT assignment_id, version FROM (SELECT assignment_id, ordinal, version, count(*) OVER () AS seats FROM bridge_assignments
      WHERE event_id = s.id AND round = s.current_round AND
        (CASE WHEN s.table_mode THEN device_key = t.device_key ELSE ns = t.device_key OR ew = t.device_key END)
      ) seats WHERE NOT s.table_mode OR seats.seats = 1 ORDER BY ordinal LIMIT 1) a ON true
    WHERE sw.id = 1`.catch(missingStorage);
  assertNormalizedMode(row);
  if (!row.id || (row.archived && !director)) throw new DomainError('找不到賽事', 404);
  if (!row.club_enabled || !row.device_key)
    throw new DomainError('連結已失效或收分模式未開啟', 403);
  return {
    size: Number(row.movement_size) as InterleavedSize,
    label: String(row.device_label ?? '桌次收分'),
    pair: String(row.device_key),
    revision: Number(row.revision),
    assignmentId: row.assignment_id as string | null,
    version: Number(row.version),
    v: row.assignment_id ? `${row.revision}.${row.version}` : String(row.revision),
  };
}

function tabletEvent(
  settings: BridgeEvent,
  rows: Record<string, unknown>[],
  scores: Record<string, unknown>[],
) {
  const event: BridgeEvent = {
    ...settings,
    assignments: rows.map((row) => row.document as Assignment),
    club: { ...settings.club!, tokens: {}, confirmations: {} },
    participants: [],
    boards: [],
    audit: [],
    results: normalizeResults(
      Object.fromEntries(
        scores.map((row) => {
          const r = row.document as Result;
          return [resultKey(r.assignmentId, r.board), r];
        }),
      ),
    ),
  };
  delete event.club!.inputOverrides;
  for (const row of rows)
    if (row.input_pair) {
      event.club!.inputOverrides ??= {};
      event.club!.inputOverrides[(row.document as Assignment).id] = String(row.input_pair);
    }
  for (const row of rows)
    if (row.confirmation) {
      const key = clubConfirmationKey(event, row.document as Assignment);
      event.club!.confirmations[key] = row.confirmation as NonNullable<
        BridgeEvent['club']
      >['confirmations'][string];
    }
  return event;
}

async function tableCards(sql: Sql, id: string, assignment?: Assignment) {
  if (!assignment) return { boards: [], scores: [] };
  const [boards, scores] = await Promise.all([
    sql`SELECT document_json FROM bridge_boards WHERE event_id = ${id} AND board_number IN (
      SELECT value::int FROM jsonb_array_elements_text(${JSON.stringify(assignment.boards)}::jsonb)) ORDER BY ordinal`,
    sql`SELECT document FROM bridge_results WHERE event_id = ${id} AND assignment_id = ${assignment.id}`,
  ]);
  return { boards: boards.map((row) => JSON.parse(String(row.document_json)) as Board), scores };
}

export async function pollTablet(
  sql: Sql,
  id: string,
  hash: string,
  v: string | null,
  director: boolean,
): Promise<{ unchanged: true } | (ClubView & { v: string })> {
  const head = await tabletHead(sql, id, hash, director);
  if (v === head.v) return { unchanged: true };
  const [[stage], people] = await Promise.all([
    sql`SELECT settings, (SELECT min(round) FROM bridge_assignments WHERE event_id = s.id
      AND round > s.current_round) AS next_scheduled FROM bridge_stages s WHERE id = ${id}`,
    sql`SELECT document FROM bridge_participants WHERE event_id = ${id} ORDER BY ordinal`,
  ]);
  if (!stage) throw new DomainError('找不到賽事', 404);
  const settings = stage.settings as BridgeEvent;
  const round = settings.currentRound ?? 0;
  const nextRound = Math.min(
    nextScheduledRound({ ...settings, assignments: [] }, round),
    settings.knockout && stage.next_scheduled !== null ? Number(stage.next_scheduled) : Infinity,
  );
  const rows =
    await sql`SELECT document, confirmation, input_pair, device_key FROM bridge_assignments
    WHERE event_id = ${id} AND round IN (${round}, ${nextRound}) ORDER BY ordinal`;
  const mine = (r: number) => {
    const seats = rows.filter((row) => {
      const a = row.document as Assignment;
      return (
        a.round === r &&
        (settings.club?.mode === 'table'
          ? row.device_key === head.pair
          : a.ns === head.pair || a.ew === head.pair)
      );
    });
    return (
      settings.club?.mode === 'table' && seats.length !== 1 ? undefined : seats[0]?.document
    ) as Assignment | undefined;
  };
  const assignment = mine(round),
    next = mine(nextRound);
  const { scores, boards } = await tableCards(sql, id, assignment);
  if ((await tabletHead(sql, id, hash, director)).v !== head.v)
    return pollTablet(sql, id, hash, v, director);
  const event = tabletEvent(settings, rows, scores);
  event.boards = boards;
  event.participants = people.map((row) => row.document as Participant);
  const { size, label } = head;
  return {
    ...clubView(event, head.pair, {
      assignment,
      next,
      nextRound,
      label,
      nextLabel: label,
      roundLabel: roundLabel(event, round, size),
      nextRoundLabel: roundLabel(event, nextRound, size),
    }),
    v: head.v,
  };
}

type ClubPlay = Extract<Mutation, { action: 'club-play' }>;

export async function submitTablet(
  sql: Sql,
  id: string,
  command: ClubPlay,
  director: boolean,
  baseUpdatedAt?: string,
) {
  let base = baseUpdatedAt;
  for (let attempt = 0; attempt < 6; attempt++) {
    const head = await tabletHead(sql, id, command.tokenHash, director);
    const [[stage], rows, requests] = await Promise.all([
      sql`SELECT settings FROM bridge_stages WHERE id = ${id}`,
      sql`SELECT document, confirmation, input_pair, participant_count FROM bridge_assignments WHERE event_id = ${id} AND assignment_id = ${head.assignmentId}`,
      sql`SELECT 1 FROM bridge_requests WHERE event_id = ${id} AND request_id = ${command.requestId}`,
    ]);
    if (requests.length) return;
    if (!stage) throw new DomainError('找不到賽事', 404);
    const assignment = rows[0]?.document as Assignment | undefined;
    const { boards, scores } = await tableCards(sql, id, assignment);
    const event = tabletEvent(stage.settings as BridgeEvent, rows, scores);
    event.boards = boards;
    event.club!.tokens[head.pair] = command.tokenHash;
    const current = resultUpdatedAt(event, command.result);
    if (staleClubResult(current, base))
      throw new DomainError('本桌成績已更新，請重新檢查後再提交', 409);
    base ??= current;
    const context: MutationContext = { event, at: new Date().toISOString(), changes: [] };
    applyCollectionCommand(context, command, assignment);
    if (
      command.result &&
      event.knockout?.nodes.some(
        (node) =>
          event.knockout!.decisions[node.id]?.basis !== undefined &&
          knockoutLegs(event, node).some(
            (leg) => assignment?.matchId === knockoutMatchId(node.id, leg.round),
          ),
      )
    )
      throw new DomainError('這場對局已確認勝負；請先撤回勝負與尚未開打的後續對局，再更正成績');
    const cap = captureSql();
    queueDataVersion(cap.sql, id);
    const confirmation = event.club!.confirmations[clubConfirmationKey(event, assignment!)];
    if (command.confirm)
      cap.sql`WITH upd AS (UPDATE bridge_assignments SET confirmation = ${JSON.stringify(confirmation)}::jsonb,
        version = current_setting('valet.data_version')::bigint WHERE event_id = ${id} AND assignment_id = ${head.assignmentId}
        AND version = ${head.version} AND (SELECT revision FROM bridge_stages WHERE id = ${id}) = ${head.revision}
        RETURNING 1) SELECT 1 / (SELECT count(*)::int FROM upd)`;
    else {
      cap.sql`WITH upd AS (UPDATE bridge_assignments SET version = current_setting('valet.data_version')::bigint
        WHERE event_id = ${id} AND assignment_id = ${head.assignmentId} AND version = ${head.version}
        AND (SELECT revision FROM bridge_stages WHERE id = ${id}) = ${head.revision}
        RETURNING 1) SELECT 1 / (SELECT count(*)::int FROM upd)`;
      const result = context.changes[0].after!;
      cap.sql`INSERT INTO bridge_results(event_id, assignment_id, board, revision, written_at_event_revision, document)
        VALUES (${id}, ${result.assignmentId}, ${result.board}, 1, currval('bridge_data_version'), ${JSON.stringify(result)}::jsonb)
        ON CONFLICT(event_id, assignment_id, board) DO UPDATE SET revision = bridge_results.revision + 1,
          written_at_event_revision = excluded.written_at_event_revision, document = excluded.document`;
    }
    const audit = {
      at: context.at,
      action: '收分卡提交/確認',
      detail: context.detail,
      reason: command.reason,
      ...(context.changes.length ? { changes: context.changes } : {}),
    };
    cap.sql`INSERT INTO bridge_requests(event_id, request_id, ordinal) VALUES (${id}, ${command.requestId}, currval('bridge_data_version'))`;
    cap.sql`INSERT INTO bridge_audit(event_id, seq, document) SELECT ${id}, nextval('bridge_data_version'),
      ${JSON.stringify(audit)}::jsonb || jsonb_build_object('revision', version)
      FROM bridge_assignments WHERE event_id = ${id} AND assignment_id = ${head.assignmentId}`;
    try {
      await commitSql(sql, cap.batches);
    } catch (error) {
      if (!isConflict(error)) throw error;
      if (attempt === 5) throw new DomainError('本桌成績已更新，請重新檢查後再提交', 409);
      continue;
    }
    if (command.confirm) await settleRound(sql, id, command.round);
    return;
  }
}

async function settleRound(sql: Sql, id: string, round: number) {
  for (;;) {
    const [[stage], rows, scores] = await Promise.all([
      sql`SELECT settings, revision FROM bridge_stages WHERE id = ${id}`,
      sql`SELECT document, confirmation, input_pair, participant_count FROM bridge_assignments WHERE event_id = ${id} AND round = ${round}`,
      sql`SELECT r.document FROM bridge_results r JOIN bridge_assignments a USING(event_id, assignment_id)
        WHERE a.event_id = ${id} AND a.round = ${round}`,
    ]);
    if (!stage) return;
    const event = tabletEvent(stage.settings as BridgeEvent, rows, scores);
    event.participants.length = Number(rows[0]?.participant_count ?? 0);
    if (!clubRoundReady(event, round)) return;
    const cap = captureSql();
    queueDataVersion(cap.sql, id);
    cap.sql`WITH upd AS (UPDATE bridge_stages SET revision = current_setting('valet.data_version')::int, updated_at = now(),
      settings = jsonb_set(jsonb_set(settings, '{club,finalized}', ${JSON.stringify([...event.club!.finalized, round])}::jsonb),
        '{roundPhase}', CASE WHEN current_round = ${round} THEN '"break"'::jsonb ELSE settings->'roundPhase' END) WHERE id = ${id} AND revision = ${stage.revision} RETURNING 1)
      SELECT 1 / (SELECT count(*)::int FROM upd)`;
    const audit = {
      at: new Date().toISOString(),
      action: '圈次結算',
      reason: '全桌確認',
      detail: `第 ${round} 圈全桌確認完成，自動結算並發布成績`,
    };
    cap.sql`INSERT INTO bridge_audit(event_id, seq, document) SELECT ${id}, nextval('bridge_data_version'),
      ${JSON.stringify(audit)}::jsonb || jsonb_build_object('revision', revision) FROM bridge_stages WHERE id = ${id}`;
    try {
      await commitSql(sql, cap.batches);
      return;
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }
}
