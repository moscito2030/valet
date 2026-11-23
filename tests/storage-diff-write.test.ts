import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { clubReviewVersion } from '../lib/club-confirmation';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { pasteStage } from '../lib/domain/paste-stage';
import { exportPbn } from '../lib/imports';
import { mutationSchema } from '../lib/model';
import { captureSql, commitSql, type SqlBatch } from '../lib/storage/batch';
import { createNormalizedRepository } from '../lib/storage/normalized';
import { loadStage, queueStage } from '../lib/storage/rows';
import { createTestDb } from './helpers/sql';

const legacyTables = [
  'stages', 'participants', 'assignments', 'boards', 'results', 'penalties', 'audit', 'requests',
  'competitions', 'competition_audit', 'competition_requests', 'competition_redirects',
];
const fixedTime = "TIMESTAMPTZ '2026-01-01T00:00:00Z'";

function fixture(id: string, rounds = 2) {
  return createEvent({
    name: '合成賽段', kind: 'pairs', names: ['A', 'B', 'C', 'D', 'E', 'F'],
    date: '2026-01-01', venue: '', rounds, boardsPerRound: 1,
  }, id);
}

async function dump(db: Awaited<ReturnType<typeof createTestDb>>['db']) {
  return Promise.all(legacyTables.map(async (name) =>
    (await db.query(`SELECT row_to_json(t)::text AS row FROM bridge_${name} t ORDER BY 1`)).rows));
}

test('差異寫入與全量重寫產生相同的既有資料列，並維護桌版本與圈狀態', async (t) => {
  const current = await createTestDb();
  t.after(current.close);
  const legacy = await createTestDb();
  t.after(legacy.close);
  let batches: SqlBatch[] = [];
  for (const { db, sql } of [current, legacy]) {
    for (const table of ['requests', 'competition_requests'])
      await db.exec(`ALTER TABLE bridge_${table} ALTER COLUMN created_at SET DEFAULT ${fixedTime}`);
    const transact = sql.transaction!;
    sql.transaction = (queries) => {
      if (sql === current.sql) batches = queries;
      return transact(queries.map((query) => ({ ...query, text: query.text.replaceAll('now()', fixedTime) })));
    };
  }

  const repo = createNormalizedRepository(current.sql);
  const event = fixture('diff');
  const id = event.id;
  const compare = async () => assert.deepEqual(await dump(current.db), await dump(legacy.db));
  const mirrorUnchangedPath = () => commitSql(legacy.sql, batches.filter(({ text }) =>
    !/bridge_table_state|bridge_rounds|bridge_migrations/.test(text)));
  await repo.insertEvent(event);
  await mirrorUnchangedPath();
  await compare();

  const originalTable = event.assignments[0];
  const row = async () => (await current.sql`SELECT version, content_hash, confirmed_version
    FROM bridge_table_state WHERE event_id = ${id} AND assignment_id = ${originalTable.id}`)[0];
  const initial = await row();

  async function mutate(action: object, boardsChange = false) {
    const prior = (await loadStage(legacy.sql, id))!;
    const command = mutationSchema.parse({
      revision: prior.stored.event.revision, requestId: randomUUID(), reason: '合成測試', ...action,
    });
    const next = await repo.mutateEvent(id, command);
    const actual = (await loadStage(current.sql, id))!;
    assert.equal(batches.some(({ text }) => /bridge_boards/.test(text)), boardsChange, command.action);
    assert.ok(!batches.some(({ text }) => /DELETE FROM bridge_audit/.test(text)), command.action);
    const cap = captureSql();
    queueStage(cap.sql, actual.stored, actual.writes, {
      eventRevision: prior.stored.event.revision, results: prior.stored.event.results,
      writes: prior.writes, revisions: prior.revisions,
    }, command.action === 'adjusted-score');
    await commitSql(legacy.sql, cap.batches);
    await compare();
    return next.event;
  }

  await mutate({ action: 'pair-name', participantId: event.participants[0].id, name: 'A2' });
  await mutate({ action: 'penalty', participantId: event.participants[0].id, amount: 2 });
  await mutate({ action: 'pbn', pbn: exportPbn({ boards: event.boards.map(({ number }) => makeBoard(number)) }) }, true);
  await mutate({ action: 'board-publication', board: 1, published: true }, true);

  const { id: assignmentId, ns, ew, boards: [board] } = originalTable;
  const inputToken = 'a'.repeat(64), confirmToken = 'b'.repeat(64);
  await mutate({ action: 'club-config', enabled: true, participantId: ns, tokenHash: inputToken });
  await mutate({ action: 'club-config', enabled: true, participantId: ew, tokenHash: confirmToken });
  const open = await mutate({ action: 'round-control', round: 1, phase: 'playing' });
  assert.deepEqual(await row(), initial);
  const result = { assignmentId, board, declarer: 'N', strain: 'S', level: 2, doubled: 1, tricks: 8, lead: '' };
  const played = await mutate({ action: 'club-play', round: 1, confirm: false, tokenHash: inputToken, result });
  const entered = await row();
  assert.equal(entered.version, 2);
  assert.notEqual(entered.content_hash, initial.content_hash);
  assert.equal(entered.confirmed_version, null);
  await mutate({
    action: 'club-play', round: 1, confirm: true, tokenHash: confirmToken,
    reviewVersion: clubReviewVersion(played, originalTable),
  });
  assert.deepEqual(await row(), { ...entered, confirmed_version: 2 });

  await mutate({ action: 'results', results: [{ ...result, tricks: 9 }] });
  const corrected = await row();
  assert.equal(corrected.version, 3);
  assert.equal(corrected.confirmed_version, null);
  assert.notEqual(corrected.content_hash, entered.content_hash);
  await mutate({ action: 'ruling', board, assignmentId, cancelled: true });
  await mutate({ action: 'adjusted-score', board, assignmentId, award: { ns: 'A+', ew: 'A−' } });
  const settled = await mutate({ action: 'club-finalize', round: 1, force: true });
  assert.deepEqual(await current.sql`SELECT state FROM bridge_rounds WHERE event_id = ${id} AND round = 1`,
    [{ state: 'settled' }]);
  await mutate({ action: 'clear-results', confirmName: event.name });
  const rearranged = await mutate({ action: 'movement-plan', plan: 'double-mitchell', rounds: 1, boardsPerRound: 1 }, true);
  assert.deepEqual(await current.sql`SELECT round FROM bridge_rounds WHERE event_id = ${id}`, [{ round: 1 }]);
  assert.equal((await current.sql`SELECT assignment_id FROM bridge_table_state WHERE event_id = ${id}`).length,
    rearranged.assignments.length);

  for (const { sql } of [current, legacy]) {
    await sql`UPDATE bridge_requests SET ordinal = ordinal + 20 WHERE event_id = ${id}`;
    const prior = (await loadStage(sql, id))!;
    const next = structuredClone(prior.stored);
    next.event.audit = next.event.audit.slice(2);
    next.event.revision++;
    next.requests = next.requests.slice(1).reverse();
    const cap = captureSql();
    queueStage(cap.sql, next, prior.writes, {
      eventRevision: prior.stored.event.revision, results: prior.stored.event.results,
      writes: prior.writes, revisions: prior.revisions,
      ...(sql === current.sql ? { stored: prior.stored, ordinals: prior.ordinals } : {}),
    });
    await commitSql(sql, cap.batches);
    if (sql === current.sql) {
      assert.ok(batches.some(({ text }) => /DELETE FROM bridge_audit/.test(text)));
      assert.ok(!batches.some(({ text }) => /bridge_boards/.test(text)));
    }
  }
  await compare();

  const inserted = pasteStage(settled, {
    name: '合成副本', sameCompetition: true, include: { setup: true, roster: true, boards: true, results: true },
  });
  await repo.insertStage(id, inserted, (await repo.getCompetition(id)).competition.revision);
  await mirrorUnchangedPath();
  await compare();
  assert.equal((await current.sql`SELECT version FROM bridge_table_state WHERE event_id = ${inserted.id}`).length,
    inserted.assignments.length);
  assert.ok((await current.sql`SELECT version FROM bridge_table_state WHERE event_id = ${inserted.id}`)
    .every(({ version }) => version === 1));
  await current.sql`INSERT INTO bridge_migrations (name, stage_id, stage_revision, fingerprint)
    VALUES ('per-table-v1', ${inserted.id}, ${inserted.revision}, 'synthetic')`;
  await repo.deleteEvent(inserted.id, inserted.revision);
  await mirrorUnchangedPath();
  await compare();
  assert.deepEqual(await current.sql`SELECT * FROM bridge_table_state WHERE event_id = ${inserted.id}`, []);
  assert.deepEqual(await current.sql`SELECT * FROM bridge_rounds WHERE event_id = ${inserted.id}`, []);
  assert.deepEqual(await current.sql`SELECT * FROM bridge_migrations WHERE stage_id = ${inserted.id}`, []);
  assert.equal(open.currentRound, 1);
});

test('舊資料庫缺少影子表時仍可新增、修改、刪除賽段', async (t) => {
  const { db, sql, close } = await createTestDb();
  t.after(close);
  await db.exec('DROP TABLE bridge_table_state, bridge_rounds, bridge_migrations');
  const repo = createNormalizedRepository(sql);
  const event = fixture('without-shadow');
  await repo.insertEvent(event);
  const next = await repo.mutateEvent(event.id, mutationSchema.parse({
    action: 'penalty', participantId: event.participants[0].id, amount: 2,
    revision: event.revision, requestId: randomUUID(), reason: '合成測試',
  }));
  assert.equal(next.event.penalties?.[event.participants[0].id], 2);
  await repo.deleteEvent(event.id, next.event.revision);
  assert.equal(await loadStage(sql, event.id), null);
});
