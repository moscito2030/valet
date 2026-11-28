import { clubAccepted, clubConfirmationKey } from '../club-confirmation';
import { resultKey, type BridgeEvent } from '../model';
import type { Sql } from './neon';
import { checkStage } from './projection';
import { missingStorage } from './switch';

export type ClubStatus = {
  revision: number;
  stageRevision: number;
  currentRound: number;
  finalized: number[];
  assignments: Record<string, {
    version: number;
    boards: number[];
    confirmed: boolean;
    accepted: boolean;
  }>;
};

export function localClubStatus(event: BridgeEvent): ClubStatus {
  const currentRound = event.currentRound ?? 0, finalized = event.club?.finalized ?? [];
  return {
    revision: event.revision, stageRevision: event.revision, currentRound, finalized,
    assignments: Object.fromEntries(event.assignments
      .filter(a => a.round === currentRound || (a.round < currentRound && !finalized.includes(a.round)))
      .map(a => [a.id, { version: event.revision, boards: a.boards.filter(b => event.results[resultKey(a.id, b)]),
        confirmed: !!event.club?.confirmations[clubConfirmationKey(event, a)], accepted: clubAccepted(event, a) }])),
  };
}

export async function readClubStatus(sql: Sql, id: string, validator: string | null) {
  // CASE leaves the round and receipt subqueries unexecuted when the validator matches.
  const [row] = await sql`WITH head AS MATERIALIZED (
    SELECT sw.mode, sw.per_table_at, s.id, greatest(s.revision,
      (SELECT max(version) FROM bridge_assignments WHERE event_id = s.id),
      (SELECT max(version) FROM bridge_penalties WHERE event_id = s.id)) AS version
    FROM bridge_storage_switch sw LEFT JOIN bridge_stages s ON s.id = ${id} WHERE sw.id = 1)
    SELECT head.*, CASE WHEN ('"' || head.version || '"') IS DISTINCT FROM ${validator} THEN (
      SELECT jsonb_build_object('revision', head.version, 'stageRevision', s.revision, 'currentRound', s.current_round,
        'finalized', s.finalized_rounds, 'assignments', coalesce((
          SELECT jsonb_object_agg(a.assignment_id, jsonb_build_object('version', a.version,
            'confirmed', a.confirmation IS NOT NULL, 'accepted', a.accepted, 'boards', coalesce((
              SELECT jsonb_agg(r.board ORDER BY r.board) FROM bridge_results r
              WHERE r.event_id = s.id AND r.assignment_id = a.assignment_id), '[]'::jsonb)))
          FROM bridge_assignments a WHERE a.event_id = s.id AND a.round <= s.current_round
            AND (a.round = s.current_round OR NOT s.finalized_rounds @> to_jsonb(a.round))), '{}'::jsonb))
      FROM bridge_stages s WHERE s.id = head.id) END AS status FROM head`.catch(missingStorage);
  checkStage(row, true);
  const headers = { ETag: `"${row.version}"`, 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
  return headers.ETag === validator ? new Response(null, { status: 304, headers }) : Response.json(row.status, { headers });
}
