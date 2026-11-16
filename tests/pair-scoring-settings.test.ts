import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent } from '../lib/domain/event-factory';
import { canMutate } from '../lib/mutation-permissions';
import { applyMutation } from '../lib/mutations/apply';
import { mutationSchema, type Mutation } from '../lib/model';
import { project } from '../lib/scoring';

test('pair scoring and trim can change until a result exists', () => {
  const event = createEvent({
    name: '計分設定',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-16',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  let stored = { event, projection: project(event), requests: [] };
  const command = (extra: object) =>
    mutationSchema.parse({
      action: 'settings',
      status: 'live',
      reason: '變更雙人計分',
      revision: stored.event.revision,
      requestId: randomUUID(),
      ...extra,
    }) as Mutation;
  assert.equal(canMutate('admin', command({ pairMethod: 'butler' })), false);
  assert.equal(canMutate('director', command({ pairMethod: 'butler' })), true);
  stored = applyMutation(stored, command({ pairMethod: 'butler', trim: 'one' }));
  assert.equal(stored.event.pairMethod, 'butler');
  assert.equal(stored.event.trim, 'one');
  assert.equal(stored.event.neuberg, false);
  stored = applyMutation(stored, command({ pairMethod: 'mp', neuberg: true }));
  assert.equal(stored.event.pairMethod, 'mp');
  assert.equal(stored.event.neuberg, true);
  assert.equal(stored.event.trim, 'none');
  const assignment = stored.event.assignments[0];
  stored.event.results[`${assignment.id}:1`] = {
    assignmentId: assignment.id,
    board: 1,
    level: 1,
    strain: 'NT',
    doubled: 1,
    declarer: 'N',
    tricks: 7,
    lead: '',
    nsScore: 90,
    updatedAt: stored.event.updatedAt,
  };
  assert.throws(() => applyMutation(stored, command({ pairMethod: 'crossimp' })), /成績/);
  assert.throws(
    () => applyMutation({ ...stored, event: { ...stored.event, kind: 'teams', results: {} } }, command({ pairMethod: 'mp' })),
    /雙人/,
  );
});
