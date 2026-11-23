import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { clubConfirmationKey, clubReviewVersion } from '../lib/club-confirmation';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { resultKey, type BridgeEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { captureSql, commitSql } from '../lib/storage/batch';
import { seedResultWrites } from '../lib/storage/cell-write';
import { migratePerTable } from '../lib/storage/per-table-migration';
import { queueStage } from '../lib/storage/rows';
import { createTestDb } from './helpers/sql';

function fixture(id: string, kind: BridgeEvent['kind'], rounds: number, boardsPerRound: number) {
  return createEvent({
    name: '合成賽段', date: '2026-01-01', venue: '', kind,
    names: ["A", "B", "C", "D", "E", "F"], rounds: rounds || undefined, boardsPerRound: boardsPerRound || undefined,
  }, id);
}

function club(event: BridgeEvent, mode: 'table' | 'pair') {
  event.club = { mode, enabled: true, tokens: {}, confirmations: {}, finalized: [] };
  event.currentRound = 2;
  const [accepted, stale] = event.assignments;
  for (const a of [accepted, stale]) {
    for (const board of a.boards)
      event.results[resultKey(a.id, board)] = {
        assignmentId: a.id, board, level: 2, strain: 'S', declarer: 'N',
        doubled: 1, tricks: 8, lead: '', nsScore: 110, updatedAt: event.updatedAt,
      };
    event.club.confirmations[clubConfirmationKey(event, a)] = {
      at: '2026-01-02T00:00:00.000Z', forced: a === accepted, reviewVersion: clubReviewVersion(event, a),
    };
  }
  event.results[resultKey(stale.id, stale.boards[0])].tricks++;
  return accepted;
}

test('每桌遷移預覽、回填、重跑與回退均保留既有表指紋', async (t) => {
  const { db, sql, close } = await createTestDb();
  t.after(close);
  await db.exec('DROP TABLE bridge_table_state, bridge_rounds, bridge_migrations');

  const tables = fixture('tables', 'pairs', 2, 2);
  const accepted = club(tables, 'table');
  tables.club!.finalized = [1];
  const pairs = fixture('pairs', 'pairs', 2, 1);
  const pairAccepted = club(pairs, 'pair');
  const teams = fixture('teams', 'teams', 2, 1);
  teams.currentRound = 1;
  teams.roundPhase = 'break';
  const unscheduled = fixture('unscheduled', 'pairs', 0, 0);
  const legacy = fixture('legacy-fifteen', 'pairs', 5, 3);
  legacy.boards = legacy.boards.map(({ number }) => makeBoard(number));
  const events = [tables, pairs, teams, unscheduled, legacy];
  const cap = captureSql();
  for (const event of events)
    queueStage(cap.sql, { event, requests: [], projection: project(event) }, seedResultWrites(event));
  await commitSql(sql, cap.batches);

  const expected = events.reduce((sum, event) => sum + event.assignments.length + event.rounds, 0);
  await assert.rejects(migratePerTable(sql, { mode: 'apply' }), /VALET_PER_TABLE_MIGRATION/);
  await assert.rejects(migratePerTable(sql, { mode: 'down' }), /VALET_PER_TABLE_MIGRATION/);
  const dry = await migratePerTable(sql, { mode: 'dry-run' });
  assert.equal(dry.added, expected);
  const hashedRows = await sql`SELECT md5(row_to_json(t)::text) AS hash FROM bridge_boards t WHERE event_id = ${legacy.id}`;
  const hash = createHash('sha256').update(hashedRows.map((row) => row.hash).sort().join('')).digest('hex').slice(0, 16);
  assert.deepEqual(dry.stages.find((stage) => stage.id === legacy.id)?.before.bridge_boards, { count: 15, hash });
  assert.deepEqual(await sql`SELECT to_regclass('bridge_table_state') AS shadow`, [{ shadow: null }]);

  const authorization = '1';
  const applied = await migratePerTable(sql, { mode: 'apply', authorization });
  assert.equal(applied.added, expected);
  assert.equal(applied.stages.length, events.length);
  assert.deepEqual(applied.stages.map((stage) => stage.after), dry.stages.map((stage) => stage.before));
  assert.deepEqual(await sql`SELECT event_id, assignment_id, confirmed_forced FROM bridge_table_state
    WHERE confirmed_version = version ORDER BY event_id`, [
    { event_id: pairs.id, assignment_id: pairAccepted.id, confirmed_forced: true },
    { event_id: tables.id, assignment_id: accepted.id, confirmed_forced: true },
  ]);
  assert.deepEqual(await sql`SELECT round, state FROM bridge_rounds WHERE event_id = ${tables.id} ORDER BY round`,
    [{ round: 1, state: 'settled' }, { round: 2, state: 'open' }]);
  assert.deepEqual(await sql`SELECT round, state FROM bridge_rounds WHERE event_id = ${teams.id} ORDER BY round`,
    [{ round: 1, state: 'closed' }, { round: 2, state: 'pending' }]);
  assert.equal((await migratePerTable(sql, { mode: 'apply', authorization })).added, 0);

  await sql`UPDATE bridge_table_state SET confirmed_forced = false
    WHERE event_id = ${tables.id} AND assignment_id = ${accepted.id}`;
  const drift = await migratePerTable(sql, { mode: 'apply', authorization });
  assert.equal(drift.added, 0);
  assert.match(drift.stages.find((stage) => stage.id === tables.id)!.warnings.join(' '), /不一致/);
  await assert.rejects(migratePerTable(sql, { mode: 'down', authorization }), /已停止回退/);
  assert.deepEqual(await sql`SELECT count(*)::int AS n FROM bridge_table_state`, [{ n: expected - 11 }]);
  await sql`UPDATE bridge_table_state SET confirmed_forced = true
    WHERE event_id = ${tables.id} AND assignment_id = ${accepted.id}`;

  const down = await migratePerTable(sql, { mode: 'down', authorization });
  assert.equal(down.stages.reduce((sum, stage) => sum + stage.deleted, 0), expected);
  assert.deepEqual(down.stages.map((stage) => stage.after), dry.stages.map((stage) => stage.before));
  assert.deepEqual(await sql`SELECT
    (SELECT count(*)::int FROM bridge_table_state) AS tables,
    (SELECT count(*)::int FROM bridge_rounds) AS rounds,
    (SELECT count(*)::int FROM bridge_migrations) AS markers`, [{ tables: 0, rounds: 0, markers: 0 }]);
});

test('既有表指紋在批次內變更會回滾回填與遷移標記', async (t) => {
  const { sql, close } = await createTestDb();
  t.after(close);
  const event = fixture('rollback', 'pairs', 1, 1);
  const cap = captureSql();
  queueStage(cap.sql, { event, requests: [], projection: project(event) }, {});
  await commitSql(sql, cap.batches);
  const transaction = sql.transaction!;
  sql.transaction = (batches) => batches.some(({ text }) => text.includes('INSERT INTO bridge_migrations'))
    ? transaction([
      ...batches.slice(0, -1),
      { text: 'UPDATE bridge_stages SET revision = revision + 1 WHERE id = $1', values: [event.id] },
      batches.at(-1)!,
    ])
    : transaction(batches);
  await assert.rejects(migratePerTable(sql, { mode: 'apply', authorization: '1' }), /已回滾/);
  assert.deepEqual(await sql`SELECT revision FROM bridge_stages`, [{ revision: 1 }]);
  assert.deepEqual(await sql`SELECT * FROM bridge_table_state`, []);
  assert.deepEqual(await sql`SELECT * FROM bridge_rounds`, []);
  assert.deepEqual(await sql`SELECT * FROM bridge_migrations`, []);
});
