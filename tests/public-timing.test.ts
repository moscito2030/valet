import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import test from 'node:test';
import { createEvent } from '../lib/domain/event-factory';
import { mutationSchema, resultKey, type Assignment, type BridgeEvent, type Mutation } from '../lib/model';
import { canMutate } from '../lib/mutation-permissions';
import { publicSnapshot } from '../lib/read-models/public-event';
import { project, teamMatchScores, vp } from '../lib/scoring';
import type { Sql } from '../lib/storage/neon';
import { createNormalizedRepository, readScoreboard } from '../lib/storage/normalized';
import { readProgress } from '../lib/storage/progress';
import { submitTablet } from '../lib/storage/tablet';
import { tableDeviceKey } from '../lib/table-device';
import { createTestDb } from './helpers/sql';

const items = ['vp', 'contract', 'hands'] as const;
const timings = ['manual', 'round', 'board'] as const;

function fixture(kind: BridgeEvent['kind'] = 'teams') {
  const event = createEvent({ name: 'Public timing', kind, names: ['A', 'B', 'C', 'D'],
    date: '2026-01-02', venue: '', rounds: 1, boardsPerRound: 2 });
  event.currentRound = 1;
  event.roundPhase = 'playing';
  event.club = { enabled: true, mode: 'table', confirmations: {}, finalized: [],
    tokens: Object.fromEntries(event.assignments.map(row => [tableDeviceKey(event, row), row.id])) };
  return event;
}

function play(row: Assignment, board = row.boards[0]): Extract<Mutation, { action: 'club-play' }> {
  return { action: 'club-play', revision: 0, requestId: randomUUID(), reason: '收分',
    tokenHash: row.id, confirm: false, round: row.round,
    result: { assignmentId: row.id, board, level: 1, strain: 'NT', declarer: 'N',
      tricks: row.room === 'closed' ? 6 : 7, doubled: 1, lead: '' } };
}

function enter(event: BridgeEvent, row: Assignment, board: number) {
  event.results[resultKey(row.id, board)] = {
    ...play(row, board).result!, nsScore: row.room === 'closed' ? -50 : 90,
    status: 'played', updatedAt: event.updatedAt,
  };
}

function visible(snapshot: ReturnType<typeof publicSnapshot>, item: typeof items[number]) {
  if (item === 'vp') return snapshot.projection.matches.some(match => match.vpA !== null);
  if (item === 'contract') return Object.keys(snapshot.results).length > 0;
  return snapshot.boards.some(board => 'deal' in board);
}

for (const timing of timings) for (const item of items) {
  test(`${item} public timing: ${timing}`, () => {
    const event = fixture();
    event.publicTiming = { [item]: timing };
    const [last, ...earlier] = [...event.assignments].reverse();
    const boards = timing === 'board' ? [1] : [1, 2];
    for (const row of earlier) for (const board of boards) enter(event, row, board);
    if (timing !== 'board') for (const board of boards) enter(event, last, board);
    assert.equal(visible(publicSnapshot(event), item), false);
    if (timing === 'manual') event.boards.forEach(board => { board.published = true; });
    if (timing === 'round') event.club!.finalized.push(1);
    if (timing === 'board') enter(event, last, 1);
    const snapshot = publicSnapshot(event, project(event));
    assert.equal(visible(snapshot, item), true);
    for (const other of items.filter(other => other !== item))
      assert.equal(visible(snapshot, other), false);
    assert.equal('publicTiming' in snapshot, false);
    if (timing === 'board') {
      if (item === 'contract') assert.ok(Object.values(snapshot.results).every(result => result.board === 1));
      if (item === 'hands') assert.deepEqual(snapshot.boards.map(board => 'deal' in board), [true, false]);
    }
  });
}

test('explicit timings act independently', () => {
  const event = fixture();
  event.publicTiming = { vp: 'board', contract: 'manual', hands: 'round' };
  for (const row of event.assignments) enter(event, row, 1);
  const before = publicSnapshot(event);
  assert.deepEqual(items.map(item => visible(before, item)), [true, false, false]);
  event.publicTiming.contract = 'board';
  assert.deepEqual(items.map(item => visible(publicSnapshot(event), item)), [true, true, false]);
  event.club!.finalized.push(1);
  assert.deepEqual(items.map(item => visible(publicSnapshot(event), item)), [true, true, true]);
});

test('board timing awards partial VP using the full match size and leaves the secondary untouched', () => {
  const event = fixture();
  for (const row of event.assignments) enter(event, row, 1);
  const legacy = teamMatchScores(event).matches[0];
  assert.equal(legacy.completed, 1);
  assert.deepEqual([legacy.vpA, legacy.vpB], [null, null]);
  const live = project({ ...event, publicTiming: { vp: 'board' } });
  const match = live.matches[0];
  assert.deepEqual([match.vpA, match.vpB, match.provisional],
    [vp(legacy.marginA, 2), vp(legacy.marginB, 2), true]);
  assert.ok(live.standings.every(row => row.secondary === 0 && row.provisional));
  for (const row of event.assignments) enter(event, row, 2);
  assert.deepEqual(project({ ...event, publicTiming: { vp: 'board' } }), project(event));
});

const progressCache = 'public, s-maxage=5, stale-while-revalidate=10';
const immutable = 'public, max-age=31536000, s-maxage=86400, immutable';

test('plain events retain progress and versioned standings cache headers', async t => {
  const db = await createTestDb();
  t.after(db.close);
  const event = fixture('pairs');
  const repo = createNormalizedRepository(db.sql);
  const { event: saved } = await repo.insertEvent(event);
  const command = mutationSchema.parse({ action: 'public-timing', vp: 'board',
    revision: saved.revision, requestId: randomUUID(), reason: '設定公開時機' });
  assert.equal(canMutate('director', command), true);
  assert.equal(canMutate('admin', command), false);
  await assert.rejects(repo.mutateEvent(event.id, command), /只有隊制賽/);

  const progress = await readProgress(db.sql, event.id, null, false);
  assert.equal(progress.status, 200);
  assert.equal(progress.headers.get('cache-control'), progressCache);
  const tag = (await progress.json()).snapshotTag.slice(1, -1);
  const unchanged = await readProgress(db.sql, event.id, progress.headers.get('etag'), false);
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get('etag'), progress.headers.get('etag'));
  assert.equal(unchanged.headers.get('cache-control'), progressCache);
  assert.equal((await readScoreboard(db.sql, event.id, null, false, tag)).headers.get('cache-control'), immutable);
  assert.equal((await readScoreboard(db.sql, event.id, null, false, '0.0')).headers.get('cache-control'), 'no-store');
});

test('stage timing and board-group commands publish once and invalidate the previous standings URL', async t => {
  const db = await createTestDb();
  t.after(db.close);
  let publishes = 0;
  const sql: Sql = (strings, ...values) => db.sql(strings, ...values);
  sql.transaction = queries => {
    publishes += queries.filter(query => query.text.startsWith('WITH published AS')).length;
    return db.sql.transaction!(queries);
  };
  const repo = createNormalizedRepository(sql);
  const event = fixture(), id = event.id;
  event.status = 'finished';
  for (const row of event.assignments) for (const board of row.boards) enter(event, row, board);
  let saved = await repo.insertEvent(event);
  const progress = () => readProgress(sql, id, null, false).then(response => response.json());
  let tag = (await progress()).snapshotTag.slice(1, -1);
  for (const [payload, shown] of [
    [{ action: 'public-timing', vp: 'board', contract: 'board', hands: 'board' }, true],
    [{ action: 'public-timing', vp: 'manual', contract: 'manual', hands: 'manual' }, false],
    [{ action: 'board-publication', board: 1, published: true }, true],
    [{ action: 'board-publication', board: 1, published: false }, false],
    [{ action: 'public-timing' }, false],
  ] as const) {
    const before = publishes;
    saved = await repo.mutateEvent(id, mutationSchema.parse({ ...payload, revision: saved.event.revision,
      requestId: randomUUID(), reason: '公開時機測試' }));
    const receipt = await progress();
    assert.deepEqual(Object.keys(receipt).sort(), ['collectionProgress', 'enteredBoards', 'receivedByParticipant', 'snapshotTag']);
    const next = receipt.snapshotTag.slice(1, -1);
    assert.notEqual(next, tag);
    assert.equal(publishes, before + 1);
    assert.equal((await readScoreboard(sql, id, null, false, tag)).headers.get('cache-control'), 'no-store');
    const fresh = await readScoreboard(sql, id, null, false, next);
    assert.equal(fresh.headers.get('cache-control'), immutable);
    const snapshot = await fresh.json();
    assert.deepEqual(items.map(item => visible(snapshot, item)), [shown, shown, shown]);
    tag = next;
  }
  assert.equal((await repo.getEvent(id, false, false)).event.publicTiming, undefined);
});

test('board timing rebuilds lazily after the floor without projecting on tablet submits', async t => {
  const db = await createTestDb();
  t.after(db.close);
  let publishes = 0;
  const sql: Sql = (strings, ...values) => db.sql(strings, ...values);
  sql.transaction = queries => {
    publishes += queries.filter(query => query.text.startsWith('WITH published AS')).length;
    return db.sql.transaction!(queries);
  };
  const repo = createNormalizedRepository(sql);
  for (const timing of ['board', 'manual', undefined] as const) {
    const event = fixture(), id = event.id;
    if (timing) event.publicTiming = { vp: timing };
    await repo.insertEvent(event);
    const progress = () => readProgress(sql, id, null, false).then(response => response.json());
    const old = (await progress()).snapshotTag;
    const before = publishes;
    if (timing === 'board') {
      const session = new Session();
      session.connect();
      try {
        await session.post('Profiler.enable');
        await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
        for (const row of event.assignments) await submitTablet(sql, id, play(row), false);
        const { result } = await session.post('Profiler.takePreciseCoverage');
        const calls = result.flatMap(script => script.url.endsWith('/lib/scoring.ts') ? script.functions : [])
          .filter(fn => fn.functionName === 'project' &&
            fn.ranges[0].endOffset - fn.ranges[0].startOffset === project.toString().length)
          .reduce((n, fn) => n + fn.ranges[0].count, 0);
        assert.equal(calls, 0);
      } finally {
        session.disconnect();
      }
    } else for (const row of event.assignments) await submitTablet(sql, id, play(row), false);
    assert.equal((await progress()).snapshotTag, old);
    assert.equal(publishes, before);
    await sql`UPDATE bridge_stages SET updated_at = now() - interval '31 seconds' WHERE id = ${id}`;
    const fresh = (await progress()).snapshotTag;
    if (timing === 'board') {
      assert.notEqual(fresh, old);
      assert.equal(publishes, before + 1);
      const snapshot = await (await readScoreboard(sql, id, null, false, fresh.slice(1, -1))).json();
      assert.equal(snapshot.projection.matches[0].provisional, true);
      assert.deepEqual(Object.keys(snapshot.results), []);
    } else {
      assert.equal(fresh, old);
      assert.equal(publishes, before);
    }
    await sql`UPDATE bridge_stages SET updated_at = now() - interval '31 seconds' WHERE id = ${id}`;
    assert.equal((await progress()).snapshotTag, fresh);
    assert.equal(publishes, before + Number(timing === 'board'));
  }
});

const golden: { event: BridgeEvent; expected: Record<string, unknown> }[] =
  JSON.parse(readFileSync(new URL('./fixtures/public-pairs-master-golden.json', import.meta.url), 'utf8'));
for (const { event, expected } of golden) {
  test(`master public snapshot equivalence: ${event.id}`, () => {
    // E4 moved enteredBoards, receivedByParticipant and collectionProgress to /progress.
    // E7 combines those fields with the held snapshot on the client.
    const { enteredBoards, receivedByParticipant, collectionProgress, ...snapshot } = expected;
    const current = publicSnapshot(event);
    assert.deepEqual(JSON.parse(JSON.stringify(current)), snapshot);
    assert.deepEqual(publicSnapshot({ ...event, publicTiming: event.kind === 'pairs'
      ? { vp: 'board', contract: 'manual', hands: 'round' } : {} }), current);
  });
}
