import type { BridgeEvent, Projection } from '../model';
import { DomainError } from '../domain-error';
import { assertNormalizedMode, missingStorage } from './switch';
import { project } from '../scoring';
import type { Sql } from './neon';

export async function cachedProjection(
  sql: Sql,
  event: BridgeEvent,
  audience: 'full' | 'public',
): Promise<Projection | null> {
  for (;;) {
    const [cached] =
      await sql`SELECT data_version, projection FROM bridge_projection_cache WHERE event_id = ${event.id}
      AND audience = ${audience}`;
    if (cached && Number(cached.data_version) > event.revision) return null;
    if (Number(cached?.data_version) === event.revision && typeof cached.projection === 'object')
      return cached.projection as Projection;
    // A timestamp reserves this version while its owner computes outside the HTTP transaction.
    const [claim] =
      await sql`INSERT INTO bridge_projection_cache(event_id, audience, data_version, projection)
      VALUES (${event.id}, ${audience}, ${event.revision}, to_jsonb(clock_timestamp()))
      ON CONFLICT(event_id, audience) DO UPDATE SET data_version = excluded.data_version, projection = excluded.projection
      WHERE bridge_projection_cache.data_version < excluded.data_version OR
        (bridge_projection_cache.data_version = excluded.data_version AND
        CASE WHEN jsonb_typeof(bridge_projection_cache.projection) = 'string' THEN
          (bridge_projection_cache.projection #>> '{}')::timestamptz < now() - interval '5 minutes' ELSE false END)
      RETURNING projection`;
    if (!claim) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    try {
      const projection = project(event);
      await sql`UPDATE bridge_projection_cache SET projection = ${JSON.stringify(projection)}::jsonb
        WHERE event_id = ${event.id} AND audience = ${audience} AND data_version = ${event.revision}
          AND projection = ${JSON.stringify(claim.projection)}::jsonb`;
      return projection;
    } catch (error) {
      await sql`DELETE FROM bridge_projection_cache WHERE event_id = ${event.id} AND audience = ${audience}
        AND data_version = ${event.revision} AND projection = ${JSON.stringify(claim.projection)}::jsonb`;
      throw error;
    }
  }
}

export async function scoreboardVersion(sql: Sql, id: string, director: boolean) {
  const [row] =
    await sql`SELECT sw.mode, sw.per_table_at, s.id, s.archived OR c.archived AS archived,
      greatest(s.revision, (SELECT max(version) FROM bridge_assignments WHERE event_id = s.id),
        (SELECT max(version) FROM bridge_penalties WHERE event_id = s.id)) AS version, c.revision
    FROM bridge_storage_switch sw LEFT JOIN bridge_stages s ON s.id = ${id}
    LEFT JOIN bridge_competitions c ON c.id = s.competition_id WHERE sw.id = 1`.catch(
      missingStorage,
    );
  assertNormalizedMode(row);
  if (!row.id || (row.archived && !director)) throw new DomainError('找不到賽事', 404);
  return `"${row.version}.${row.revision ?? row.version}"`;
}
