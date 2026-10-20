import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { clubView, audienceEvent } from '../lib/club-view';
import { clubAccepted } from '../lib/club-confirmation';
import { tableDevices, tableDeviceKey, deviceAssignment } from '../lib/table-device';
import { interleavedAssignments } from '../lib/team-movement';
import { mutationSchema, type StoredEvent, type Kind, type Assignment } from '../lib/model';
import { swissPreview } from '../lib/swiss';

function setup(kind: Kind, count = 4, interleaved = false) {
  const e = createEvent({
    name: 'Table device QA',
    kind,
    names: Array.from({ length: count }, (_, i) => `Participant ${i + 1}`),
    date: '2026-10-17',
    venue: '',
    rounds: 2,
    boardsPerRound: 1,
  });
  if (interleaved) {
    e.assignments = interleavedAssignments(e, 3);
    e.teamMovement = 'interleaved';
  }
  let state: StoredEvent = { event: e, projection: project(e), requests: [] };
  const apply = (body: object) => {
    const command = mutationSchema.parse({
      revision: state.event.revision,
      requestId: randomUUID(),
      reason: '裝置收分測試',
      ...body,
    });
    state = applyMutation(state, command);
    return state.event;
  };
  apply({ action: 'club-config', enabled: true, mode: 'table' });
  tableDevices(e).forEach((d, i) =>
    apply({
      action: 'club-config',
      enabled: true,
      deviceKey: d.key,
      tokenHash: (i + 1).toString(16).padStart(64, '0'),
    }),
  );
  const key = (a: Assignment) => tableDeviceKey(state.event, a);
  const hash = (a: Assignment) => state.event.club!.tokens[key(a)];
  const result = (a: Assignment) => ({
    assignmentId: a.id,
    board: a.boards[0],
    level: 3,
    strain: 'NT',
    declarer: 'N',
    doubled: 1,
    tricks: 9,
    lead: '',
  });
  const enter = (a: Assignment) =>
    apply({
      action: 'club-play',
      tokenHash: hash(a),
      round: a.round,
      confirm: false,
      result: result(a),
    });
  const confirm = (a: Assignment) =>
    apply({
      action: 'club-play',
      tokenHash: hash(a),
      round: a.round,
      confirm: true,
      reviewVersion: clubView(state.event, key(a)).reviewVersion,
    });
  return {
    get e() {
      return state.event;
    },
    get state() {
      return state;
    },
    apply,
    key,
    hash,
    result,
    enter,
    confirm,
  };
}

for (const kind of ['pairs', 'teams'] as const)
  test(`${kind}: devices follow tables, enforce room boundaries and lock exact reviewed scores`, () => {
    const s = setup(kind);
    s.apply({ action: 'round-control', round: 1, phase: 'playing' });
    const a = s.e.assignments[0],
      other = s.e.assignments.find((b) => b.round === 1 && b.id !== a.id)!;
    const view = clubView(s.e, s.key(a));
    assert.equal(view.mode, 'table');
    assert.equal(view.role, 'shared');
    assert.equal(view.assignment!.id, a.id);
    assert.equal(view.boards.length, 1);
    assert.equal('deal' in view.boards[0], false);
    assert.throws(
      () =>
        s.apply({
          action: 'club-play',
          tokenHash: s.hash(a),
          round: 1,
          confirm: false,
          result: s.result(other),
        }),
      /只能/,
    );
    assert.throws(() => s.confirm(a), /未輸入/);
    s.enter(a);
    const old = clubView(s.e, s.key(a)).reviewVersion;
    s.apply({
      action: 'club-play',
      tokenHash: s.hash(a),
      round: 1,
      confirm: false,
      result: { ...s.result(a), tricks: 10 },
    });
    assert.throws(
      () =>
        s.apply({
          action: 'club-play',
          tokenHash: s.hash(a),
          round: 1,
          confirm: true,
          reviewVersion: old,
        }),
      /更新/,
    );
    s.confirm(a);
    assert.equal(clubAccepted(s.e, a), true);
    assert.equal(clubAccepted(s.e, other), false);
    assert.throws(() => s.enter(a), /鎖定/);
    assert.equal(Object.keys(audienceEvent(s.e).results).length, 0);
    assert.equal('club' in audienceEvent(s.e), false);
    assert.equal(clubView(s.e, s.key(a)).tableGuide?.kind, 'table');
    assert.throws(
      () => s.apply({ action: 'club-config', enabled: true, mode: 'pair' }),
      /切換|隊制/,
    );
    s.apply({ action: 'club-finalize', round: 1, force: true });
    assert.equal(s.e.currentRound, 2);
    const next = deviceAssignment(s.e, s.key(a), 2)!;
    assert.equal(clubView(s.e, s.key(a)).assignment!.id, next.id);
    assert.throws(() => s.enter(a), /不開放/);
    assert.throws(
      () =>
        s.apply({
          action: 'club-play',
          tokenHash: s.hash(a),
          round: 2,
          confirm: false,
          result: s.result(a),
        }),
      /只能/,
    );
    s.enter(next);
    const token = s.hash(next);
    s.apply({
      action: 'club-config',
      enabled: true,
      deviceKey: s.key(next),
      tokenHash: 'f'.repeat(64),
    });
    assert.throws(
      () =>
        s.apply({
          action: 'club-play',
          tokenHash: token,
          round: 2,
          confirm: false,
          result: s.result(next),
        }),
      /無效/,
    );
    s.apply({ action: 'club-config', enabled: false });
    assert.throws(() => s.enter(next), /無效/);
  });

test('team rooms with the same confirmation team do not approve each other', () => {
  const s = setup('teams');
  s.apply({ action: 'round-control', round: 1, phase: 'playing' });
  const a = s.e.assignments[0],
    b = s.e.assignments.find((x) => x.matchId === a.matchId && x.id !== a.id)!;
  s.apply({ action: 'club-config', enabled: true, assignmentId: b.id, inputPair: a.ns });
  s.enter(a);
  s.enter(b);
  s.confirm(a);
  assert.equal(clubAccepted(s.e, b), false);
  assert.notEqual(s.key(a), s.key(b));
  s.confirm(b);
  assert.equal(clubAccepted(s.e, b), true);
  s.apply({ action: 'results', results: [{ ...s.result(a), tricks: 11 }] });
  assert.equal(clubAccepted(s.e, a), false);
  assert.equal(clubAccepted(s.e, b), true);
});

test('interleaved table stays bound when logical room switches; pending is not a bye', () => {
  const s = setup('teams', 3, true);
  const a = s.e.assignments.find(
    (a) =>
      a.round === 1 &&
      s.e.assignments.some((b) => b.round === 2 && b.table === a.table && b.room !== a.room),
  )!;
  const b = s.e.assignments.find((b) => b.round === 2 && b.table === a.table)!;
  assert.ok(a);
  assert.equal(s.key(a), s.key(b));
  assert.equal(tableDevices(s.e).length, 3);
  s.apply({ action: 'round-control', round: 1, phase: 'playing' });
  s.enter(a);
  s.confirm(a);
  assert.equal(clubView(s.e, s.key(a)).tableGuide?.kind, 'table');
  s.apply({ action: 'club-finalize', round: 1, force: true });
  assert.equal(clubView(s.e, s.key(a)).assignment!.id, b.id);
  s.enter(b);
  const noTable = clubView({ ...s.e, currentRound: 3 }, s.key(a));
  assert.equal(noTable.assignment, undefined);
  assert.equal(noTable.guide, null);
});

test('Swiss collection waits for both rooms approval and force-finalize never opens an unpublished round', () => {
  const s = setup('teams');
  s.apply({ action: 'swiss-config', mode: 'current', rounds: 2, boardsPerRound: 1, byeVp: 12 });
  s.apply({ action: 'swiss-publish', round: 1, partial: false });
  tableDevices(s.e).forEach((d, i) =>
    s.apply({
      action: 'club-config',
      enabled: true,
      deviceKey: d.key,
      tokenHash: (i + 1).toString(16).padStart(64, '0'),
    }),
  );
  s.apply({ action: 'round-control', round: 1, phase: 'playing' });
  for (const a of s.e.assignments) s.enter(a);
  assert.throws(() => swissPreview(s.e, 2, false), /未收齊/);
  for (const a of s.e.assignments) s.confirm(a);
  assert.equal(swissPreview(s.e, 2, false).pairs.length, 2);
  assert.deepEqual(s.e.club!.finalized, [1]);
  assert.equal(s.e.currentRound, 1);
  assert.equal(s.e.roundPhase, 'break');
  assert.equal(clubView(s.e, s.key(s.e.assignments[0])).tableGuide?.kind, 'pending');
  assert.equal(swissPreview(s.e, 2, false).pairs.length, 2);
});

test('switching binding before scores revokes previous tokens and ambiguous table schedules fail closed', () => {
  const s = setup('pairs'),
    old = s.hash(s.e.assignments[0]);
  s.apply({ action: 'club-config', enabled: false, mode: 'pair' });
  assert.deepEqual(s.e.club!.tokens, {});
  s.apply({ action: 'club-config', enabled: true });
  s.apply({ action: 'round-control', round: 1, phase: 'playing' });
  assert.throws(
    () =>
      s.apply({
        action: 'club-play',
        tokenHash: old,
        round: 1,
        confirm: false,
        result: s.result(s.e.assignments[0]),
      }),
    /無效/,
  );
  const t = setup('pairs');
  const a = t.e.assignments[0];
  t.e.assignments.push({ ...a, id: 'ambiguous' });
  assert.equal(deviceAssignment(t.e, t.key(a), 1), undefined);
  assert.throws(() => t.apply({ action: 'club-config', enabled: true }), /多筆/);
});
