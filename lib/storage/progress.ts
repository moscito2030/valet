import { resultKey, type Assignment, type Result } from '../model';
import { eventProgress } from '../round-progress';
import type { Sql } from './neon';
import { cacheProjection, checkStage } from './projection';
import { missingStorage } from './switch';

export async function readProgress(sql: Sql, id: string, validator: string | null, director: boolean): Promise<Response> {
  const [head] = await sql`SELECT sw.mode, sw.per_table_at, s.id, s.current_round, s.public_version, c.revision, s.archived OR c.archived AS archived,
      (SELECT coalesce(max(version),0) FROM bridge_assignments WHERE event_id = s.id) AS version
    FROM bridge_storage_switch sw LEFT JOIN bridge_stages s ON s.id = ${id}
    LEFT JOIN bridge_competitions c ON c.id = s.competition_id WHERE sw.id = 1`.catch(missingStorage);
  checkStage(head, director);
  const version = Number(head.version);
  const publication = `${head.public_version}.${head.revision ?? head.public_version}`;
  const snapshotTag = `"${publication}"`;
  const headers = { ETag: `"${version}.${publication}"`, 'Cache-Control': 'private, no-cache' };
  if (headers.ETag === validator) return new Response(null, { status: 304, headers });
  const [cached] = await sql`SELECT projection FROM bridge_projection_cache
    WHERE event_id = ${id} AND audience = 'progress' AND data_version = ${version}`;
  if (cached) return Response.json({ ...cached.projection as object, snapshotTag }, { headers });
  const rows = await sql`SELECT a.assignment_id, a.round, a.room, a.ns, a.ew,
      a.boards, a.match_id, a.version, a.exempt, a.provisional,
      (SELECT jsonb_object_agg(r.board,r.status) FROM bridge_results r
       WHERE r.event_id = a.event_id AND r.assignment_id = a.assignment_id) AS scores
    FROM bridge_assignments a WHERE a.event_id = ${id} ORDER BY a.ordinal`;
  if (version !== Math.max(0, ...rows.map(row => Number(row.version))))
    return readProgress(sql, id, validator, director);
  const results: Record<string, Pick<Result, 'status'>> = {};
  const exempt = new Set<string>(), pending = new Set<string>();
  const assignments = rows.map(row => {
    const id = String(row.assignment_id), matchId = String(row.match_id);
    if (row.exempt) exempt.add(id);
    if (row.provisional) pending.add(matchId);
    for (const [board, status] of Object.entries(row.scores ?? {}))
      results[resultKey(id, Number(board))] = { status: status as Result['status'] };
    return { id, matchId, round: Number(row.round), room: row.room as Assignment['room'],
      ns: String(row.ns), ew: String(row.ew), boards: row.boards as number[] };
  });
  const progress = eventProgress({ assignments, results, currentRound: Number(head.current_round) }, exempt, pending);
  await cacheProjection(sql, id, 'progress', version, progress);
  return Response.json({ ...progress, snapshotTag }, { headers });
}
