import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { mutationSchema } from '../lib/model';
import { allRoundsComplete } from '../lib/round-progress';
import { exportMovement, parseMovement } from '../lib/imports';

const base = { name: 'Deferred movement', names: ['A','B','C','D','E','F'], date: '2026-10-17', venue: '' };
const command = (payload: object, revision = 1) => mutationSchema.parse({ revision, requestId: randomUUID(), reason: '測試延後編排', ...payload });
for (const kind of ['pairs', 'teams'] as const) test(`${kind}: create without rounds, then generate a complete movement`, () => {
  const event = createEvent({ ...base, kind });
  const stored = { event, projection: project(event), requests: [] };
  assert.equal(event.rounds, 0);
  assert.equal(event.assignments.length, 0);
  assert.equal(event.boards.length, 0);
  assert.equal(allRoundsComplete(event), false);
  assert.throws(() => applyMutation(stored, command({ action: 'settings', status: 'finished' })), /待設定/);
  assert.throws(() => applyMutation(stored, command({ action: 'round-control', round: 1, phase: 'playing' })), /待設定/);
  assert.throws(() => applyMutation(stored, command({ action: 'results-import', csv: 'invalid' })), /待設定/);
  const next = applyMutation(stored, command({ action: 'movement-plan', plan: kind === 'pairs' ? 'double-mitchell' : 'team-round-robin', rounds: 3, boardsPerRound: 2 }));
  assert.equal(next.event.rounds, 3);
  assert.equal(next.event.boardsPerRound, 2);
  assert.equal(next.event.boards.length, 6);
  assert.equal(next.event.assignments.length, kind === 'pairs' ? 9 : 18);
  assert.equal(parseMovement(exportMovement(next.event), next.event).length, next.event.assignments.length);
  assert.equal(next.event.currentRound, 0);
  assert.equal(event.rounds, 0);
  const a = next.event.assignments[0];
  const scored = applyMutation(next, command({ action: 'results', results: [{ assignmentId: a.id, board: a.boards[0], level: 1, strain: 'NT', doubled: 1, declarer: 'N', tricks: 7, lead: '' }] }, 2));
  assert.throws(() => applyMutation(scored, command({ action: 'movement-plan', plan: 'barometer', rounds: 4, boardsPerRound: 1 }, 3)), /尚未收分/);
});

test('deferred double winner preserves groups and MiniBridge; invalid setup is atomic', () => {
  const event = createEvent({ ...base, kind: 'pairs', gameMode: 'minibridge', movementPlan: 'double-mitchell' });
  assert.deepEqual(event.participants.map(p => p.group), ['NS','NS','NS','EW','EW','EW']);
  const stored = { event, projection: project(event), requests: [] };
  for (const [rounds, boardsPerRound] of [[4, 2], [3, 0], [3, 44]]) {
    assert.throws(() => applyMutation(stored, command({ action: 'movement-plan', plan: 'double-mitchell', rounds, boardsPerRound })));
    assert.equal(event.rounds, 0);
  }
  const next = applyMutation(stored, command({ action: 'movement-plan', plan: 'double-mitchell', rounds: 3, boardsPerRound: 2 }));
  assert.ok(next.event.boards.every(b => b.vulnerability === 'None'));
  const resized = applyMutation(next, command({ action: 'movement-plan', plan: 'double-mitchell', rounds: 2, boardsPerRound: 3 }, 2));
  assert.equal(resized.event.rounds, 2);
  assert.equal(resized.event.boards.length, 9);
  assert.equal(resized.event.assignments.length, 6);
  assert.throws(() => createEvent({ ...base, kind: 'pairs', rounds: 2 }), /每圈牌數/);
});
