import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvent, applyMutation } from '../lib/events';
import { audienceEvent } from '../lib/club-view';
import { createFinishedEventCache } from '../lib/finished-event-cache';
import { project } from '../lib/scoring';
import { canMutate } from '../lib/mutation-permissions';
import type { Mutation, StoredEvent } from '../lib/model';

function fixture() {
  const event = createEvent({ name: '覆核測試', kind: 'pairs', names: ['甲', '乙', '丙', '丁'], date: '2026-10-20', venue: '', rounds: 1, boardsPerRound: 1 });
  let state: StoredEvent = { event, projection: project(event), requests: [] };
  const apply = (command: object) => state = applyMutation(state, {
    revision: state.event.revision, requestId: `test-${state.event.revision}`,
    reason: '測試覆核', ...command,
  } as Mutation);
  const rows = event.assignments.flatMap(a => a.boards.map(board => ({
    assignmentId: a.id, board, level: 3, strain: 'NT', declarer: 'N', doubled: 1, tricks: 9, lead: '',
  })));
  return { get state() { return state; }, apply, rows };
}

test('last round enters review, allows corrections, and only director finalization freezes scores', () => {
  const f = fixture();
  assert.throws(() => f.apply({ action: 'settings', status: 'review' }), /全部圈次/);
  assert.throws(() => f.apply({ action: 'settings', status: 'finished' }), /未收齊/);
  f.apply({ action: 'results', results: f.rows });
  assert.equal(f.state.event.status, 'review');
  f.apply({ action: 'results', results: [{ ...f.rows[0], tricks: 10 }] });
  assert.equal(f.state.event.status, 'review');
  const legacy = { ...f.state.event, status: 'live' as const };
  assert.equal(audienceEvent(legacy).status, 'review', 'old fully collected events are not final');
  f.apply({ action: 'settings', status: 'finished' });
  const finish = { action: 'settings', status: 'finished' } as Mutation;
  assert.equal(canMutate('admin', finish), false);
  assert.equal(canMutate('director', finish), true);
  const before = structuredClone(f.state);
  for (const command of [
    { action: 'settings', status: 'live' },
    { action: 'settings', status: 'review' },
    { action: 'results', results: f.rows },
    { action: 'results-import', csv: '' },
    { action: 'clear-result', assignmentId: f.rows[0].assignmentId, board: f.rows[0].board },
    { action: 'clear-results', confirmName: f.state.event.name },
    { action: 'penalty', participantId: 'p1', amount: 3 },
    { action: 'knockout-reopen', nodeId: 'any' },
    { action: 'round-control', round: 1, phase: 'playing' },
  ]) assert.throws(() => f.apply(command), /已定案/);
  assert.deepEqual(f.state, before);
});

test('final cache requires current catalog version and never retains review snapshots', () => {
  const memory = new Map<string, string>();
  const cache = createFinishedEventCache(() => ({
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
  }));
  const f = fixture();
  f.apply({ action: 'results', results: f.rows });
  const review = audienceEvent(f.state.event);
  cache.write(review, 'v1');
  assert.equal(cache.read(review.id, 'v1'), null);
  f.apply({ action: 'settings', status: 'finished' });
  const final = audienceEvent(f.state.event);
  cache.write(final, 'v2');
  assert.deepEqual(cache.read(final.id, 'v2'), JSON.parse(JSON.stringify(final)));
  assert.equal(cache.read(final.id), null, 'no catalog permission/version means no cache');
  assert.equal(cache.read(final.id, 'v3'), null, 'metadata/publication changes invalidate');
  assert.equal(cache.read('another-event', 'v2'), null);
  cache.write(review, 'v3');
  assert.equal(cache.read(final.id, 'v2'), null);
  const unavailable = createFinishedEventCache(() => { throw new Error('blocked'); });
  assert.doesNotThrow(() => unavailable.write(final, 'v2'));
  assert.equal(unavailable.read(final.id, 'v2'), null);
  memory.set('valet-finished-events-v1', 'broken JSON');
  assert.equal(cache.read(final.id, 'v2'), null);
});
