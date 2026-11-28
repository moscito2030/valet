import { clubAccepted, clubConfirmationKey } from '../club-confirmation';
import type { Assignment, Board, BridgeEvent, Participant, Result } from '../model';
import { normalizeResults } from '../result-status';
import { resultKey } from '../model';
import { knockoutExemptAssignments } from '../knockout-status';
import { publicSnapshot } from '../read-models/public-event';
import { materializeBoardPublication } from '../board-publication';
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
  const stages = await sql`SELECT id, revision, settings, updated_at FROM bridge_stages ORDER BY id`;
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
  cap.sql`UPDATE bridge_penalties SET version = nextval('bridge_data_version')`;
  for (const stage of stages) {
    const rows =
      await sql`SELECT document FROM bridge_assignments WHERE event_id = ${stage.id} ORDER BY ordinal`;
    const assignments = rows.map((r) => r.document as Assignment);
    const event = { ...(stage.settings as BridgeEvent), assignments };
    const exempt = knockoutExemptAssignments(event);
    const devices = new Map(tableDevices(event).map((d) => [d.key, d.label]));
    let confirmations = 0;
    for (const assignment of assignments) {
      const confirmation = event.club?.confirmations[clubConfirmationKey(event, assignment)];
      if (confirmation) confirmations++;
      cap.sql`UPDATE bridge_assignments SET round = ${assignment.round}, table_label = ${String(assignment.table)},
        exempt = ${exempt.has(assignment.id)}, provisional = ${!!event.provisionalVp?.[assignment.matchId]},
        input_pair = ${event.club?.inputOverrides?.[assignment.id] ?? null}, room = ${assignment.room}, ns = ${assignment.ns}, ew = ${assignment.ew},
        device_key = ${tableDeviceKey(event, assignment)}, version = nextval('bridge_data_version'),
        confirmation = ${confirmation ? JSON.stringify(confirmation) : null}::jsonb
        WHERE event_id = ${stage.id} AND assignment_id = ${assignment.id}`;
    }
    const tokens = Object.entries(event.club?.tokens ?? {});
    for (const [key, hash] of tokens)
      cap.sql`INSERT INTO bridge_club_tokens(event_id, device_key, token_hash, movement_size, device_label) VALUES (
        ${stage.id}, ${key}, ${hash}, ${interleavedSize(event)}, ${devices.get(key) ?? null})`;
    if (apply) {
      const [people, boards, results, penalties] = await Promise.all([
        sql`SELECT document FROM bridge_participants WHERE event_id = ${stage.id} ORDER BY ordinal`,
        sql`SELECT document_json FROM bridge_boards WHERE event_id = ${stage.id} ORDER BY ordinal`,
        sql`SELECT document FROM bridge_results WHERE event_id = ${stage.id}`,
        sql`SELECT participant_id, amount FROM bridge_penalties WHERE event_id = ${stage.id}`,
      ]);
      event.id = String(stage.id);
      event.updatedAt ??= new Date(String(stage.updated_at)).toISOString();
      event.participants = people.map(r => r.document as Participant);
      event.boards = boards.map(r => JSON.parse(String(r.document_json)) as Board);
      event.results = Object.fromEntries(results.map(row => {
        const r = row.document as Result;
        return [resultKey(r.assignmentId, r.board), r];
      }));
      backfillAccepted(cap.sql, event);
      event.penalties = Object.fromEntries(penalties.map(r => [String(r.participant_id), Number(r.amount)]));
      cap.sql`UPDATE bridge_stages SET public_version = nextval('bridge_data_version') WHERE id = ${stage.id}`;
      const snapshot = publicSnapshot(materializeBoardPublication(event));
      cap.sql`INSERT INTO bridge_projection_cache(event_id, audience, data_version, projection)
        SELECT id, 'public', public_version, jsonb_set(${JSON.stringify(snapshot)}::jsonb, '{revision}', to_jsonb(greatest(revision,
          (SELECT max(version) FROM bridge_assignments WHERE event_id = s.id),
          (SELECT max(version) FROM bridge_penalties WHERE event_id = s.id)))) FROM bridge_stages s WHERE id = ${stage.id}`;
    }
    report.push({
      stage: stage.id,
      assignments: assignments.length,
      tokens: tokens.length,
      confirmations,
    });
  }
  cap.sql`UPDATE bridge_competitions c SET organizer_id = (
    SELECT min(organizer_id) FROM bridge_stages WHERE competition_id = c.id
      AND btrim(organizer_id) <> '' HAVING count(DISTINCT organizer_id) = 1)`;
  cap.sql`UPDATE bridge_storage_switch SET per_table_at = now() WHERE id = 1`;
  if (apply)
    await commitSql(sql, [
      ...perTableSchemaStatements.map((text) => ({ text, values: [] })),
      ...cap.batches,
    ]);
  return report;
}

function backfillAccepted(sql: Sql, event: BridgeEvent) {
  const review = { club: event.club, results: normalizeResults(event.results) };
  for (const assignment of event.assignments)
    if (event.club?.confirmations[clubConfirmationKey(event, assignment)])
      sql`UPDATE bridge_assignments SET accepted = ${clubAccepted(review, assignment)} WHERE event_id = ${event.id} AND assignment_id = ${assignment.id}`;
}
