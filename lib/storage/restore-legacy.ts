import { competitionKey, type StoredCompetition } from '../competition-record';
import type { Discussion } from '../discussion';
import { canonical } from './cell-write';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { loadCompetitions, loadStages } from './rows';
import { storageGate } from './switch';

export async function restoreLegacy(sql: Sql, options: { dryRun: boolean }) {
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。請用 HTTPS 連線，不要用 Postgres 連線埠。');
  if ((await storageGate(sql)).mode !== 'normalized')
    throw new Error('restore requires the normalized storage switch');
  const stages = await loadStages(sql);
  const competitions = await loadCompetitions(sql);
  const threads = await sql`SELECT key, revision, closed FROM bridge_discussion_threads ORDER BY key`;
  const comments = await sql`SELECT thread_key, ordinal, document FROM bridge_discussion_comments ORDER BY thread_key, ordinal`;
  if (options.dryRun) return format(stages.length, competitions.length, threads.length, true);
  const cap = captureSql();
  for (const stage of stages)
    cap.sql`INSERT INTO bridge_events (id, revision, document, updated_at)
      VALUES (${stage.stored.event.id}, ${stage.stored.event.revision}, ${JSON.stringify(stage.stored)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, document = EXCLUDED.document, updated_at = now()`;
  for (const competition of competitions) queueCompetitionDocument(cap.sql, competition);
  for (const thread of threads) {
    const threadComments = comments
      .filter((row) => row.thread_key === thread.key)
      .map((row) => row.document as Discussion['comments'][number]);
    const document: Discussion = {
      ...(thread.closed == null ? {} : { closed: Boolean(thread.closed) }),
      comments: threadComments,
    };
    cap.sql`INSERT INTO bridge_discussions (id, revision, document)
      VALUES (${thread.key}, ${thread.revision}, ${JSON.stringify(document)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, document = EXCLUDED.document`;
  }
  cap.sql`UPDATE bridge_storage_switch
    SET mode = 'legacy', legacy_watermark = NULL, verified_at = NULL, note = 'restored from normalized rows'
    WHERE id = 1 AND mode = 'normalized'`;
  await commitSql(sql, cap.batches);
  for (const stage of stages) {
    const saved = await sql`SELECT document FROM bridge_events WHERE id = ${stage.stored.event.id}`;
    const document = saved[0]?.document as { event?: { boards?: { deal?: unknown }[]; results?: unknown; audit?: unknown[] } };
    if (canonical(document?.event?.boards?.map((board) => board.deal)) !== canonical(stage.stored.event.boards.map((board) => board.deal)))
      throw new Error(`restore deal mismatch ${stage.stored.event.id}`);
    if (canonical(document?.event?.results) !== canonical(stage.stored.event.results))
      throw new Error(`restore result mismatch ${stage.stored.event.id}`);
    if ((document?.event?.audit?.length ?? 0) !== stage.stored.event.audit.length)
      throw new Error(`restore audit mismatch ${stage.stored.event.id}`);
  }
  return format(stages.length, competitions.length, threads.length, false);
}

function queueCompetitionDocument(sql: Sql, competition: StoredCompetition) {
  const stored = { competition: competition.competition, requests: competition.requests };
  sql`INSERT INTO bridge_events (id, revision, document, updated_at)
    VALUES (${competitionKey(competition.competition.id)}, ${competition.competition.revision}, ${JSON.stringify(stored)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, document = EXCLUDED.document, updated_at = now()`;
}

function format(events: number, competitions: number, discussions: number, dryRun: boolean) {
  return [
    `mode: ${dryRun ? 'dry-run' : 'write'}`,
    `events: ${events}`,
    `competitions: ${competitions}`,
    `discussions: ${discussions}`,
    `switch: ${dryRun ? 'unchanged' : 'legacy'}`,
    'note: legacy jsonb may reorder object keys; card-by-card deals are checked',
  ].join('\n');
}
