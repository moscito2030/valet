import { clubConfirmationKey } from '../club-confirmation';
import type { Assignment, BridgeEvent } from '../model';
import { interleavedSize } from '../team-movement';
import { tableDeviceKey, tableDevices } from '../table-device';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { perTableSchemaStatements } from './schema';

export async function migratePerTable(sql: Sql, apply: boolean) {
  const [state] = await sql`SELECT to_jsonb(s)->>'per_table_at' AS migrated
    FROM bridge_storage_switch s WHERE id = 1 AND mode = 'normalized'`;
  if (!state) throw new Error('請先啟用正規化儲存');
  if (state.migrated) return [];
  const stages = await sql`SELECT id, revision, settings FROM bridge_stages ORDER BY id`;
  const report = [];
  const cap = captureSql();
  cap.sql`DO $$ DECLARE legacy bigint; discussions bigint;
    BEGIN
    IF to_regclass('bridge_events') IS NOT NULL THEN SELECT max(revision) INTO legacy FROM bridge_events; END IF;
    IF to_regclass('bridge_discussions') IS NOT NULL THEN SELECT max(revision) INTO discussions FROM bridge_discussions; END IF;
    PERFORM setval('bridge_data_version', greatest(legacy, discussions, (SELECT max(revision) FROM bridge_discussion_threads),
    (SELECT max(revision) FROM bridge_stages), (SELECT max(revision) FROM bridge_competitions),
    (SELECT max(seq) FROM bridge_audit), (SELECT max(seq) FROM bridge_competition_audit),
    (SELECT max(revision) FROM bridge_results), (SELECT max(written_at_event_revision) FROM bridge_results),
    (SELECT last_value FROM bridge_data_version)) + 1, false); END $$`;
  for (const stage of stages) {
    const rows =
      await sql`SELECT document FROM bridge_assignments WHERE event_id = ${stage.id} ORDER BY ordinal`;
    const assignments = rows.map((r) => r.document as Assignment);
    const event = { ...(stage.settings as BridgeEvent), assignments };
    const devices = new Map(tableDevices(event).map((d) => [d.key, d.label]));
    let confirmations = 0;
    for (const assignment of assignments) {
      const confirmation = event.club?.confirmations[clubConfirmationKey(event, assignment)];
      if (confirmation) confirmations++;
      cap.sql`UPDATE bridge_assignments SET round = ${assignment.round}, table_label = ${String(assignment.table)},
        participant_count = (SELECT count(*) FROM bridge_participants WHERE event_id = ${stage.id}),
        input_pair = ${event.club?.inputOverrides?.[assignment.id] ?? null}, room = ${assignment.room}, ns = ${assignment.ns}, ew = ${assignment.ew},
        device_key = ${tableDeviceKey(event, assignment)}, version = nextval('bridge_data_version'),
        confirmation = ${confirmation ? JSON.stringify(confirmation) : null}::jsonb
        WHERE event_id = ${stage.id} AND assignment_id = ${assignment.id}`;
    }
    const tokens = Object.entries(event.club?.tokens ?? {});
    for (const [key, hash] of tokens)
      cap.sql`INSERT INTO bridge_club_tokens(event_id, device_key, token_hash, movement_size, device_label) VALUES (
        ${stage.id}, ${key}, ${hash}, ${interleavedSize(event)}, ${devices.get(key) ?? null})`;
    report.push({
      stage: stage.id,
      assignments: assignments.length,
      tokens: tokens.length,
      confirmations,
    });
  }
  cap.sql`UPDATE bridge_penalties SET version = nextval('bridge_data_version')`;
  cap.sql`UPDATE bridge_storage_switch SET per_table_at = now() WHERE id = 1`;
  if (apply)
    await commitSql(sql, [
      ...perTableSchemaStatements.map((text) => ({ text, values: [] })),
      ...cap.batches,
    ]);
  return report;
}
