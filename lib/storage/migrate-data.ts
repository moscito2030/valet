import { isStage, type StoredCompetition, type StoredDocument } from '../competition-record';
import type { Discussion } from '../discussion';
import type { StoredEvent } from '../model';
import { seedResultWrites } from './cell-write';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { deleteStageRows, loadCompetitions, loadStage, queueCompetition, queueDeleteCompetition, queueDeleteStage, queueStage, saveCompetition, saveStage } from './rows';
import { VerifyMismatch, verifyStage } from './verify-stage';
import { canonical } from './cell-write';
import { normalizedSchemaStatements } from './schema';

export class DryRunRollback extends Error {
  constructor() {
    super('dry-run');
    this.name = 'DryRunRollback';
  }
}

export type MigrationCounts = {
  id: string;
  boards: number;
  results: number;
  participants: number;
  penalties: number;
  audit: number;
};

export type MigrationReport = {
  dryRun: boolean;
  events: MigrationCounts[];
  competitions: string[];
  discussions: number;
  verified: number;
  flip: 'no' | 'normalized' | 'already-on' | 'schema-missing';
};

function counts(stored: StoredEvent): MigrationCounts {
  return {
    id: stored.event.id,
    boards: stored.event.boards.length,
    results: Object.keys(stored.event.results).length,
    participants: stored.event.participants.length,
    penalties: Object.keys(stored.event.penalties ?? {}).length,
    audit: stored.event.audit.length,
  };
}

export function formatMigrationReport(report: MigrationReport) {
  const lines = [
    `mode: ${report.dryRun ? 'dry-run' : 'write'}`,
    `events: ${report.events.length}`,
    ...report.events.map(
      (event) =>
        `event: ${event.id} boards=${event.boards} results=${event.results} participants=${event.participants} penalties=${event.penalties} audit=${event.audit}`,
    ),
    `competitions: ${report.competitions.length}`,
    ...report.competitions.map((id) => `competition: ${id}`),
    `discussions: ${report.discussions}`,
    `verified: ${report.verified}`,
    `flip: ${report.flip}`,
  ];
  if (report.flip === 'already-on')
    lines.push('refusing: copying legacy rows would overwrite the live normalized store');
  if (report.flip === 'schema-missing') lines.push('refusing: run the schema migration before the data migration');
  return lines.join('\n');
}

export async function migrateLegacyDocuments(
  sql: Sql,
  options: { dryRun: boolean },
): Promise<MigrationReport> {
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。請用 HTTPS 連線，不要用 Postgres 連線埠。');
  let mode: string | null = null;
  try {
    const rows = await sql`SELECT mode FROM bridge_storage_switch WHERE id = 1`;
    mode = rows[0] ? String(rows[0].mode) : null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01')
      return { dryRun: options.dryRun, events: [], competitions: [], discussions: 0, verified: 0, flip: 'schema-missing' };
    throw error;
  }
  if (mode === 'normalized')
    return { dryRun: options.dryRun, events: [], competitions: [], discussions: 0, verified: 0, flip: 'already-on' };
  const documents = (await readLegacySnapshot(sql)).documents;
  const report: MigrationReport = {
    dryRun: options.dryRun,
    events: documents.filter(isStage).map((event) => counts(event)),
    competitions: documents.filter((document): document is StoredCompetition => !isStage(document)).map((item) => item.competition.id),
    discussions: 0,
    verified: 0,
    flip: 'no',
  };
  if (options.dryRun) {
    for (const document of documents) {
      if (isStage(document)) await rehearseStage(sql, document);
      else await rehearseCompetition(sql, document);
      report.verified += 1;
    }
    report.discussions = await rehearseDiscussions(sql);
    return report;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await readLegacySnapshot(sql);
    for (const document of fresh.documents) {
      if (isStage(document)) await copyStage(sql, document);
      else await copyCompetition(sql, document);
    }
    report.discussions = await copyDiscussions(sql);
    const stamp = fresh.watermark;
    const flipped = await sql`UPDATE bridge_storage_switch
      SET mode = 'normalized', verified_at = now(), legacy_watermark = ${stamp}::timestamptz,
        event_count = ${fresh.documents.filter(isStage).length}, note = 'data migration verified'
      WHERE id = 1 AND mode = 'legacy'
        AND (SELECT max(updated_at)::text FROM bridge_events) IS NOT DISTINCT FROM ${stamp}
      RETURNING id`;
    if (!flipped.length) continue;
    report.verified = fresh.documents.length;
    report.events = fresh.documents.filter(isStage).map((event) => counts(event));
    report.competitions = fresh.documents
      .filter((document): document is StoredCompetition => !isStage(document))
      .map((item) => item.competition.id);
    report.flip = 'normalized';
    return report;
  }
  throw new Error('legacy rows changed during migration; switch left on legacy');
}

async function copyStage(sql: Sql, stored: StoredEvent) {
  try {
    await saveStage(sql, stored, seedResultWrites(stored.event));
    const loaded = await loadStage(sql, stored.event.id);
    if (!loaded) throw new VerifyMismatch(stored.event.id, ['missing']);
    verifyStage(stored, loaded.stored);
  } catch (error) {
    if (error instanceof VerifyMismatch) await deleteStageRows(sql, stored.event.id).catch(() => undefined);
    throw error;
  }
}

function verifyCompetition(legacy: StoredCompetition, loaded: StoredCompetition) {
  const fields: string[] = [];
  if (legacy.competition.audit.length !== loaded.competition.audit.length) fields.push('audit');
  else if (canonical(legacy.competition) !== canonical(loaded.competition)) fields.push('competition');
  if (canonical([...legacy.requests].sort()) !== canonical([...loaded.requests].sort())) fields.push('requests');
  if (fields.length) throw new VerifyMismatch(legacy.competition.id, fields);
}

async function copyCompetition(sql: Sql, stored: StoredCompetition) {
  await saveCompetition(sql, stored);
  const loaded = (await loadCompetitions(sql)).find((item) => item.competition.id === stored.competition.id);
  if (!loaded) throw new VerifyMismatch(stored.competition.id, ['missing']);
  verifyCompetition(stored, loaded);
}

export async function copyDiscussions(sql: Sql) {
  const rows = await discussionRows(sql);
  let discussions = 0;
  for (const row of rows) {
    const key = String(row.id);
    const document = row.document as Discussion;
    if (!key.startsWith('board:') || !Array.isArray(document?.comments)) continue;
    const cap = captureSql();
    cap.sql`INSERT INTO bridge_discussion_threads (key, revision, closed)
      VALUES (${key}, ${Number(row.revision) || 1}, ${document.closed ?? null})
      ON CONFLICT (key) DO UPDATE SET revision = EXCLUDED.revision, closed = EXCLUDED.closed, updated_at = now()`;
    cap.sql`DELETE FROM bridge_discussion_comments WHERE thread_key = ${key}`;
    if (document.comments.length)
      cap.sql`INSERT INTO bridge_discussion_comments (thread_key, comment_id, ordinal, document)
        SELECT ${key}, document->>'id', ordinal, document
        FROM jsonb_to_recordset(${JSON.stringify(document.comments.map((comment, ordinal) => ({ ordinal, document: comment })))}::jsonb)
          AS x(ordinal int, document jsonb)`;
    await commitSql(sql, cap.batches);
    const saved =
      await sql`SELECT count(*)::int AS n FROM bridge_discussion_comments WHERE thread_key = ${key}`;
    if (Number(saved[0]?.n ?? 0) !== document.comments.length) throw new VerifyMismatch(key, ['discussions']);
    discussions += 1;
  }
  return discussions;
}

async function discussionRows(sql: Sql) {
  try {
    return await sql`SELECT id, revision, document FROM bridge_discussions ORDER BY id`;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01') return [];
    throw error;
  }
}

async function rehearseStage(sql: Sql, stored: StoredEvent) {
  const cap = captureSql();
  queueStage(cap.sql, stored, seedResultWrites(stored.event));
  const mark = cap.batches.length;
  cap.sql`SELECT settings, projection, revision FROM bridge_stages WHERE id = ${stored.event.id}`;
  cap.sql`SELECT document_json FROM bridge_boards WHERE event_id = ${stored.event.id} ORDER BY ordinal`;
  cap.sql`SELECT document FROM bridge_results WHERE event_id = ${stored.event.id}`;
  cap.sql`SELECT document FROM bridge_participants WHERE event_id = ${stored.event.id} ORDER BY ordinal`;
  cap.sql`SELECT document FROM bridge_assignments WHERE event_id = ${stored.event.id} ORDER BY ordinal`;
  cap.sql`SELECT participant_id, amount FROM bridge_penalties WHERE event_id = ${stored.event.id}`;
  cap.sql`SELECT document FROM bridge_audit WHERE event_id = ${stored.event.id} ORDER BY seq`;
  cap.sql`SELECT request_id FROM bridge_requests WHERE event_id = ${stored.event.id} ORDER BY ordinal, request_id`;
  queueDeleteStage(cap.sql, stored.event.id);
  const results = await commitSql(sql, cap.batches);
  const stageRow = results[mark]?.[0] as
    | { settings?: StoredEvent['event']; projection?: StoredEvent['projection']; revision?: number }
    | undefined;
  if (!stageRow?.settings) throw new VerifyMismatch(stored.event.id, ['missing']);
  const event: StoredEvent['event'] = {
    ...stageRow.settings,
    revision: Number(stageRow.revision),
    participants: (results[mark + 3] ?? []).map((row) => (row as { document: StoredEvent['event']['participants'][number] }).document),
    assignments: (results[mark + 4] ?? []).map((row) => (row as { document: StoredEvent['event']['assignments'][number] }).document),
    boards: (results[mark + 1] ?? []).map((row) => JSON.parse(String((row as { document_json: string }).document_json))),
    results: Object.fromEntries(
      (results[mark + 2] ?? []).map((row) => {
        const result = (row as { document: StoredEvent['event']['results'][string] }).document;
        return [`${result.assignmentId}:${result.board}`, result];
      }),
    ),
    penalties: Object.fromEntries(
      (results[mark + 5] ?? []).map((row) => [
        String((row as { participant_id: string }).participant_id),
        (row as { amount: number }).amount,
      ]),
    ),
    audit: (results[mark + 6] ?? []).map((row) => (row as { document: StoredEvent['event']['audit'][number] }).document),
  };
  verifyStage(stored, {
    event,
    projection: stageRow.projection ?? stored.projection,
    requests: (results[mark + 7] ?? []).map((row) => String((row as { request_id: string }).request_id)),
  });
}

async function rehearseCompetition(sql: Sql, stored: StoredCompetition) {
  const cap = captureSql();
  queueCompetition(cap.sql, stored);
  const mark = cap.batches.length;
  cap.sql`SELECT document, revision FROM bridge_competitions WHERE id = ${stored.competition.id}`;
  cap.sql`SELECT document FROM bridge_competition_audit WHERE competition_id = ${stored.competition.id} ORDER BY seq`;
  cap.sql`SELECT request_id FROM bridge_competition_requests WHERE competition_id = ${stored.competition.id} ORDER BY ordinal, request_id`;
  queueDeleteCompetition(cap.sql, stored.competition.id);
  const results = await commitSql(sql, cap.batches);
  const row = results[mark]?.[0] as { document?: StoredCompetition['competition']; revision?: number } | undefined;
  if (!row?.document) throw new VerifyMismatch(stored.competition.id, ['missing']);
  const loaded: StoredCompetition = {
    competition: {
      ...row.document,
      revision: Number(row.revision),
      audit: (results[mark + 1] ?? []).map((entry) => entry.document as StoredCompetition['competition']['audit'][number]),
    },
    requests: (results[mark + 2] ?? []).map((entry) => String(entry.request_id)),
  };
  if (canonical(stored.competition) !== canonical(loaded.competition) || canonical(stored.requests) !== canonical(loaded.requests))
    throw new VerifyMismatch(stored.competition.id, ['competition']);
}

async function rehearseDiscussions(sql: Sql) {
  const rows = await discussionRows(sql);
  let discussions = 0;
  for (const row of rows) {
    const key = String(row.id);
    const document = row.document as Discussion;
    if (!key.startsWith('board:') || !Array.isArray(document?.comments)) continue;
    const cap = captureSql();
    cap.sql`INSERT INTO bridge_discussion_threads (key, revision, closed)
      VALUES (${key}, ${Number(row.revision) || 1}, ${document.closed ?? null})
      ON CONFLICT (key) DO UPDATE SET revision = EXCLUDED.revision, closed = EXCLUDED.closed, updated_at = now()`;
    cap.sql`DELETE FROM bridge_discussion_comments WHERE thread_key = ${key}`;
    if (document.comments.length)
      cap.sql`INSERT INTO bridge_discussion_comments (thread_key, comment_id, ordinal, document)
        SELECT ${key}, document->>'id', ordinal, document
        FROM jsonb_to_recordset(${JSON.stringify(document.comments.map((comment, ordinal) => ({ ordinal, document: comment })))}::jsonb)
          AS x(ordinal int, document jsonb)`;
    const mark = cap.batches.length;
    cap.sql`SELECT count(*)::int AS n FROM bridge_discussion_comments WHERE thread_key = ${key}`;
    cap.sql`DELETE FROM bridge_discussion_comments WHERE thread_key = ${key}`;
    cap.sql`DELETE FROM bridge_discussion_threads WHERE key = ${key}`;
    const results = await commitSql(sql, cap.batches);
    if (Number(results[mark]?.[0]?.n ?? 0) !== document.comments.length) throw new VerifyMismatch(key, ['discussions']);
    discussions += 1;
  }
  return discussions;
}

export async function readLegacyDocuments(sql: Sql): Promise<StoredDocument[]> {
  return (await readLegacySnapshot(sql)).documents;
}

export async function readLegacySnapshot(sql: Sql): Promise<{ documents: StoredDocument[]; watermark: string | null }> {
  const rows =
    await sql`SELECT id, document, (SELECT max(updated_at)::text FROM bridge_events) AS watermark FROM bridge_events ORDER BY id`;
  return {
    documents: rows.map((row) => row.document as StoredDocument),
    watermark: rows.length && rows[0].watermark != null ? String(rows[0].watermark) : null,
  };
}

export async function applyNormalizedSchema(query: (text: string) => Promise<unknown>) {
  for (const statement of normalizedSchemaStatements) await query(statement);
}
