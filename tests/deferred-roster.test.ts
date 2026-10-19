import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, type BridgeEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { audienceEvent } from '../lib/read-models/public-event';
import { movementOptions } from '../lib/movement-plans';
import { canMutate } from '../lib/mutation-permissions';
const empty = (kind: 'pairs' | 'teams' = 'teams', double = false) =>
  createEvent({
    name: 'Empty stage',
    kind,
    names: [],
    date: '2026-10-19',
    venue: '',
    ...(kind === 'pairs'
      ? { rankingMode: double ? ('double' as const) : ('single' as const) }
      : {}),
  });
const cmd = (e: BridgeEvent, p: object) =>
  mutationSchema.parse({
    revision: e.revision,
    requestId: randomUUID(),
    reason: '設定名單測試',
    ...p,
  });
const apply = (e: BridgeEvent, p: object) =>
  applyMutation({ event: e, projection: project(e), requests: [] }, cmd(e, p)).event;
test('empty team and pair stages have no artificial participants, scores, boards or schedules', () => {
  for (const e of [empty(), empty('pairs'), empty('pairs', true)]) {
    assert.equal(e.participants.length, 0);
    assert.equal(e.rounds, 0);
    assert.equal(e.boards.length, 0);
    assert.equal(e.assignments.length, 0);
    assert.deepEqual(project(e).standings, []);
    assert.equal(audienceEvent(e).participants.length, 0);
    assert.deepEqual(movementOptions({ ...e, rounds: 3, boardsPerRound: 2 }), []);
  }
  assert.equal(audienceEvent(empty('pairs', true)).rankingMode, 'double');
});
test('roster setup precedes scheduling and is locked after assignments exist', () => {
  let e = empty();
  e = apply(e, { action: 'participants-setup', names: ['A', 'B'] });
  e = apply(e, { action: 'movement-plan', plan: 'team-round-robin', rounds: 2, boardsPerRound: 2 });
  assert.equal(e.assignments.length, 4);
  assert.throws(() => apply(e, { action: 'participants-setup', names: ['A', 'C'] }), /編排/);
});
test('deferred Double Winner remembers choice and assigns NS/EW when roster arrives', () => {
  let e = empty('pairs', true);
  assert.throws(
    () => apply(e, { action: 'participants-setup', names: ['a', 'b', 'c', 'd'] }),
    /Double Winner/,
  );
  e = apply(e, { action: 'participants-setup', names: ['a', 'b', 'c', 'd', 'e', 'f'] });
  assert.deepEqual(
    e.participants.map((p) => p.group),
    ['NS', 'NS', 'NS', 'EW', 'EW', 'EW'],
  );
  e = apply(e, { action: 'movement-plan', plan: 'double-barometer', rounds: 3, boardsPerRound: 2 });
  assert.equal(e.rankingMode, 'double');
  assert.equal(e.assignments.length, 9);
});
test('empty stages reject scheduling, round start and club token issuance', () => {
  const e = empty();
  for (const p of [
    { action: 'movement-plan', plan: 'team-round-robin', rounds: 1, boardsPerRound: 2 },
    { action: 'club-config', enabled: true, mode: 'table' },
    {
      action: 'club-config',
      enabled: false,
      mode: 'table',
      participantId: 't1',
      tokenHash: 'a'.repeat(64),
    },
  ])
    assert.throws(() => apply(e, p), /名單/);
  assert.throws(
    () =>
      createEvent({
        name: 'empty',
        kind: 'teams',
        names: [],
        date: '2026-10-19',
        venue: '',
        rounds: 1,
        boardsPerRound: 2,
      }),
    /名單/,
  );
});
test('setup validates roster size, duplicate names, permissions and protects participant data', () => {
  let e = empty();
  for (const names of [['a'], ['a', 'a'], Array.from({ length: 33 }, (_, i) => String(i))])
    assert.throws(() => apply(e, { action: 'participants-setup', names }));
  const c = cmd(e, { action: 'participants-setup', names: ['A', 'B'] });
  assert.equal(canMutate('admin', c), false);
  assert.equal(canMutate('director', c), true);
  e = apply(e, { action: 'participants-setup', names: ['A', 'B'] });
  const id = e.participants[0].id;
  e.participants[0].players = 'Player';
  e = apply(e, { action: 'participants-setup', names: ['B', 'A', 'C'] });
  assert.equal(e.participants[1].id, id);
  assert.equal(e.participants[1].players, 'Player');
  assert.throws(() => apply(e, { action: 'participants-setup', names: ['B', 'C'] }), /原有資料/);
});

test('deferred odd team roster initializes scoring-specific bye defaults', () => {
  for (const bam of [false, true]) {
    let e = empty();
    if (bam) {
      e.teamMethod = 'bam';
      e.bam = { win: 2, draw: 1, loss: 0 };
    }
    e = apply(e, { action: 'participants-setup', names: ['A', 'B', 'C'] });
    assert.equal(e.byeVp, bam ? 0 : 12);
  }
});
