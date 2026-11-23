import type { BridgeEvent } from '../model';
import { deriveRounds, deriveTableStates } from '../per-table-state';
import type { Sql } from './neon';

export async function readPerTableSchema(sql: Sql) {
  const [row] = await sql`SELECT
    to_regclass('bridge_table_state') IS NOT NULL AS tables,
    to_regclass('bridge_rounds') IS NOT NULL AS rounds,
    to_regclass('bridge_migrations') IS NOT NULL AS migrations`;
  return {
    tables: row?.tables === true,
    rounds: row?.rounds === true,
    migrations: row?.migrations === true,
  };
}

export type PerTableSchema = Awaited<ReturnType<typeof readPerTableSchema>>;

const availability = new WeakMap<Sql, Promise<PerTableSchema>>();

export function cachedPerTableSchema(sql: Sql) {
  const cached = availability.get(sql);
  if (cached) return cached;
  // Cache only a complete schema. Until the migration creates the tables, every
  // write checks again, so shadow upkeep starts without restarting instances.
  const pending = readPerTableSchema(sql).then((schema) => {
    if (!schema.tables || !schema.rounds) availability.delete(sql);
    return schema;
  }, (error) => {
    availability.delete(sql);
    throw error;
  });
  availability.set(sql, pending);
  return pending;
}

export async function hasPerTableSchema(sql: Sql) {
  const { tables, rounds } = await cachedPerTableSchema(sql);
  return tables && rounds;
}

export function queuePerTableState(sql: Sql, event: BridgeEvent) {
  const tables = JSON.stringify(deriveTableStates(event));
  const rounds = JSON.stringify(deriveRounds(event));
  const id = event.id;
  sql`INSERT INTO bridge_table_state
    (event_id, assignment_id, content_hash, confirmed_version, confirmed_at, confirmed_forced)
    SELECT ${id}, "assignmentId", "contentHash", CASE WHEN accepted THEN 1 END, "confirmedAt", forced
    FROM jsonb_to_recordset(${tables}::jsonb)
      AS x("assignmentId" text, "contentHash" text, accepted boolean, "confirmedAt" timestamptz, forced boolean)
    ON CONFLICT (event_id, assignment_id) DO UPDATE SET
      version = CASE WHEN bridge_table_state.content_hash IS DISTINCT FROM EXCLUDED.content_hash
        THEN bridge_table_state.version + 1 ELSE bridge_table_state.version END,
      content_hash = EXCLUDED.content_hash,
      confirmed_version = CASE WHEN EXCLUDED.confirmed_version IS NOT NULL THEN
        CASE WHEN bridge_table_state.content_hash IS DISTINCT FROM EXCLUDED.content_hash
          THEN bridge_table_state.version + 1 ELSE bridge_table_state.version END END,
      confirmed_at = EXCLUDED.confirmed_at,
      confirmed_forced = EXCLUDED.confirmed_forced,
      updated_at = now()
    WHERE (bridge_table_state.content_hash, bridge_table_state.confirmed_version IS NOT NULL,
      bridge_table_state.confirmed_at, bridge_table_state.confirmed_forced)
      IS DISTINCT FROM (EXCLUDED.content_hash, EXCLUDED.confirmed_version IS NOT NULL,
        EXCLUDED.confirmed_at, EXCLUDED.confirmed_forced)
      OR (bridge_table_state.confirmed_version IS NOT NULL
        AND bridge_table_state.confirmed_version <> bridge_table_state.version)`;
  sql`DELETE FROM bridge_table_state WHERE event_id = ${id} AND assignment_id NOT IN (
    SELECT value->>'assignmentId' FROM jsonb_array_elements(${tables}::jsonb))`;
  sql`INSERT INTO bridge_rounds (event_id, round, state)
    SELECT ${id}, round, state FROM jsonb_to_recordset(${rounds}::jsonb) AS x(round int, state text)
    ON CONFLICT (event_id, round) DO UPDATE SET state = EXCLUDED.state,
      settled_at = EXCLUDED.settled_at, settled_forced = EXCLUDED.settled_forced, updated_at = now()
    WHERE (bridge_rounds.state, bridge_rounds.settled_at, bridge_rounds.settled_forced)
      IS DISTINCT FROM (EXCLUDED.state, EXCLUDED.settled_at, EXCLUDED.settled_forced)`;
  sql`DELETE FROM bridge_rounds WHERE event_id = ${id} AND round > ${event.rounds ?? 0}`;
}

export function queueDeletePerTableState(sql: Sql, id: string) {
  sql`DELETE FROM bridge_table_state WHERE event_id = ${id}`;
  sql`DELETE FROM bridge_rounds WHERE event_id = ${id}`;
}
