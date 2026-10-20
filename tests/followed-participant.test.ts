import assert from 'node:assert/strict';
import test from 'node:test';
import { createClubAutoFollow, followedParticipant, followStorageKey } from '../lib/followed-participant';

test('results default resolves only an existing participant in the marked event', () => {
  const participants = [{ id: 'p15' }, { id: 'p2' }];
  assert.equal(followedParticipant('event-a:p15', 'event-a', participants), 'p15');
  assert.equal(followedParticipant('event-a:p15', 'event-b', participants), '');
  assert.equal(followedParticipant('event-a:deleted', 'event-a', participants), '');
  assert.equal(followedParticipant('', 'event-a', participants), '');
});

test('personal collection link sets the existing ranking marker once, preserving later manual choices', () => {
  const values = new Map<string, string>([[followStorageKey, 'old:p2']]);
  const follow = createClubAutoFollow((key, value) => { values.set(key, value); });
  const view = { mode: 'pair' as const, id: 'event-a', pair: 'p15' };
  follow(view);
  assert.equal(values.get('bridge-follow'), 'event-a:p15');
  values.set(followStorageKey, '');
  follow(view);
  assert.equal(values.get(followStorageKey), '', 'background polling must not re-star an unmarked row');
  createClubAutoFollow((key, value) => { values.set(key, value); })(view);
  assert.equal(values.get(followStorageKey), 'event-a:p15', 'opening the personal link again identifies its owner');
});

test('shared table links never guess a player and storage failure does not break collection', () => {
  const writes: string[] = [];
  createClubAutoFollow((_, value) => { writes.push(value); })({ mode: 'table', id: 'event-a', pair: 'table:1' });
  assert.deepEqual(writes, []);
  assert.doesNotThrow(() => createClubAutoFollow(() => { throw new Error('storage blocked'); })({
    mode: 'pair', id: 'event-a', pair: 'p15',
  }));
});
