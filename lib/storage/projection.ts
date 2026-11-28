import { materializeBoardPublication } from '../board-publication';
import type { BridgeEvent, Projection } from '../model';
import { DomainError } from '../domain-error';
import { publicSnapshot } from '../read-models/public-event';
import { assertNormalizedMode, missingStorage } from './switch';
import { project } from '../scoring';
import type { Sql } from './neon';

export function queuePublicSnapshot(sql: Sql, event: BridgeEvent, previous: number | null) {
  const snapshot = publicSnapshot(materializeBoardPublication(event));
  sql`WITH published AS (UPDATE bridge_stages SET public_version = current_setting('valet.data_version')::bigint,
      updated_at = ${event.updatedAt} WHERE id = ${event.id} AND public_version IS NOT DISTINCT FROM ${previous}::bigint RETURNING public_version),
    saved AS (INSERT INTO bridge_projection_cache(event_id, audience, data_version, projection)
      SELECT ${event.id}, 'public', public_version,
        jsonb_set(${JSON.stringify(snapshot)}::jsonb, '{revision}', to_jsonb(public_version))
      FROM published ON CONFLICT(event_id,audience) DO UPDATE SET
        data_version = excluded.data_version, projection = excluded.projection RETURNING 1)
    SELECT 1 / (SELECT count(*)::int FROM saved)`;
}

export function cacheProjection(sql: Sql, id: string, audience: 'full' | 'progress', version: number, projection: unknown) {
  return sql`INSERT INTO bridge_projection_cache(event_id, audience, data_version, projection)
    VALUES (${id}, ${audience}, ${version}, ${JSON.stringify(projection)}::jsonb)
    ON CONFLICT(event_id,audience) DO UPDATE SET data_version = excluded.data_version, projection = excluded.projection`;
}

export async function cachedProjection(sql: Sql, event: BridgeEvent): Promise<Projection> {
  const [cached] = await sql`SELECT projection FROM bridge_projection_cache
    WHERE event_id = ${event.id} AND audience = 'full' AND data_version = ${event.revision}`;
  if (cached) return cached.projection as Projection;
  const projection = project(event);
  await cacheProjection(sql, event.id, 'full', event.revision, projection);
  return projection;
}

export function checkStage(row: Record<string, unknown>, director: boolean) {
  assertNormalizedMode(row);
  if (!row.id || (row.archived && !director)) throw new DomainError('找不到賽事', 404);
}

export async function scoreboardVersion(sql: Sql, id: string, director: boolean, full = false) {
  const [row] = await (full
    ? sql`SELECT sw.mode, sw.per_table_at, s.id, s.archived OR c.archived AS archived,
        greatest(s.revision, (SELECT max(version) FROM bridge_assignments WHERE event_id = s.id),
          (SELECT max(version) FROM bridge_penalties WHERE event_id = s.id)) AS version, c.revision
      FROM bridge_storage_switch sw LEFT JOIN bridge_stages s ON s.id = ${id}
      LEFT JOIN bridge_competitions c ON c.id = s.competition_id WHERE sw.id = 1`
    : sql`SELECT sw.mode, sw.per_table_at, s.id, s.archived OR c.archived AS archived, s.public_version AS version, c.revision
      FROM bridge_storage_switch sw LEFT JOIN bridge_stages s ON s.id = ${id}
      LEFT JOIN bridge_competitions c ON c.id = s.competition_id WHERE sw.id = 1`).catch(missingStorage);
  checkStage(row, director);
  return `"${row.version}.${row.revision ?? row.version}"`;
}
