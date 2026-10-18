import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, resultKey, type BridgeEvent, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { matchSwiss, swissPreview, swissRoundComplete, swissBasisChanged } from '../lib/swiss';
import { teamByes } from '../lib/team-movement';
import { canMutate } from '../lib/mutation-permissions';
import { allRoundsComplete } from '../lib/round-progress';
import { audienceEvent } from '../lib/club-view';
import { clubConfirmationKey, clubReviewVersion } from '../lib/club-confirmation';
function setup(n = 8, mode: 'current' | 'delayed' = 'current', rounds = 3) {
  const e = createEvent({
    name: 'Swiss test',
    kind: 'teams',
    names: Array.from({ length: n }, (_, i) => `Team ${i + 1}`),
    date: '2026-10-17',
    venue: '',
    rounds,
    boardsPerRound: 1,
  });
  let state: StoredEvent = { event: e, projection: project(e), requests: [] };
  const apply = (input: object) => {
    const c = mutationSchema.parse({
      revision: state.event.revision,
      requestId: randomUUID(),
      reason: '測試 Swiss',
      ...input,
    });
    state = applyMutation(state, c);
    return state.event;
  };
  apply({ action: 'swiss-config', mode, rounds, boardsPerRound: 1, byeVp: 12 });
  return {
    get e() {
      return state.event;
    },
    get state() {
      return state;
    },
    apply,
  };
}
function fill(e: BridgeEvent, round: number, except = new Set<string>(), strong = false) {
  for (const a of e.assignments.filter((a) => a.round === round && !except.has(a.matchId))) {
    const b = a.boards[0];
    e.results[resultKey(a.id, b)] = {
      assignmentId: a.id,
      board: b,
      level: 3,
      strain: 'NT',
      doubled: 1,
      declarer: 'N',
      tricks: 9,
      lead: '',
      nsScore: strong && a.room === 'open' ? 10000 : 0,
      updatedAt: 'test',
    };
  }
}

test('public Swiss schedules never expose scoring snapshots before or after club finalization', () => {
  for (const mode of ['current', 'delayed'] as const) {
    const s = setup(4, mode);
    s.apply({ action: 'swiss-publish', round: 1, partial: false });
    if (mode === 'delayed') s.apply({ action: 'swiss-publish', round: 2, partial: false });
    fill(s.e, 1, new Set(), true);
    s.e.club = { enabled: true, mode: 'table', tokens: {}, confirmations: {}, finalized: [] };
    for (const a of s.e.assignments.filter(a => a.round === 1)) {
      s.e.club.confirmations[clubConfirmationKey(s.e, a)] = {
        reviewVersion: clubReviewVersion(s.e, a), at: '2026-10-18T00:00:00Z', forced: false,
      };
    }
    s.apply({ action: 'swiss-publish', round: mode === 'current' ? 2 : 3, partial: false });
    const privateSnapshot = structuredClone(s.e.swiss);
    assert.ok(s.e.swiss!.publications.at(-1)!.basis.length);
    const publicData = audienceEvent(s.e);
    assert.equal(Object.keys(publicData.results).length, 0);
    for (const p of publicData.swiss!.publications) {
      assert.deepEqual(p.basis, []);
      assert.deepEqual(p.byeBasis, []);
      assert.deepEqual(p.scores, []);
    }
    assert.deepEqual(publicData.assignments.map(a => a.id), s.e.assignments.map(a => a.id));
    assert.deepEqual(s.e.swiss, privateSnapshot, 'redaction must not mutate director snapshots');
    s.e.club!.finalized = [1];
    const finalized = audienceEvent(s.e);
    assert.ok(Object.keys(finalized.results).length);
    assert.ok(finalized.swiss!.publications.every(p => !p.scores.length && !p.basis.length && !p.byeBasis.length));
  }
  const odd = setup(5);
  odd.apply({ action: 'swiss-publish', round: 1, partial: false });
  fill(odd.e, 1);
  odd.e.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [1] };
  const publicOdd = audienceEvent(odd.e);
  assert.ok(publicOdd.swiss!.publications.some(p => p.bye));
  assert.ok(publicOdd.projection.byes!.some(b => b.round === 1 && b.awarded));
});
test('first Swiss round pairs roster neighbors in both modes and gives last odd team the bye', () => {
  for (const mode of ['current', 'delayed'] as const)
    for (const n of [4, 5, 8]) {
      const s = setup(n, mode);
      const ids = s.e.participants.map((p) => p.id);
      const expected = Array.from({ length: Math.floor(n / 2) }, (_, i) => [
        ids[i * 2],
        ids[i * 2 + 1],
      ]);
      for (const partial of [false, true]) {
        const p = swissPreview(s.e, 1, partial);
        assert.deepEqual(p.pairs, expected);
        assert.equal(p.bye, n % 2 ? ids[n - 1] : undefined);
      }
      s.apply({ action: 'swiss-publish', round: 1, partial: false });
      assert.deepEqual(
        s.e.assignments.filter((a) => a.room === 'open').map((a) => [a.ns, a.ew]),
        expected,
      );
      assert.equal(swissPreview(s.e, 1, false).pairs.length, 0);
    }
});

test('Swiss is director-only and excludes pairs/interleaved, preserves legacy movement', () => {
  const s = setup();
  const c = mutationSchema.parse({
    action: 'swiss-publish',
    round: 1,
    partial: false,
    revision: 1,
    requestId: randomUUID(),
    reason: 'test',
  });
  assert.equal(canMutate('admin', c), false);
  assert.equal(canMutate('director', c), true);
  assert.throws(() => swissPreview({ ...s.e, kind: 'pairs' }, 1, false), /非交錯/);
  assert.throws(() => swissPreview({ ...s.e, teamMovement: 'interleaved' }, 1, false), /非交錯/);
  assert.throws(() => s.apply({ action: 'movement-plan', plan: 'team-round-robin' }), /Swiss/);
  assert.throws(
    () =>
      s.apply({ action: 'swiss-config', mode: 'current', rounds: 8, boardsPerRound: 1, byeVp: 12 }),
    /最多/,
  );
});
test('current Swiss requires results, avoids rematches, preserves published pairings and snapshots', () => {
  const s = setup();
  assert.equal(s.e.assignments.length, 0);
  const preview = swissPreview(s.e, 1, false);
  assert.deepEqual(swissPreview(s.e, 1, false), preview);
  s.apply({ action: 'swiss-publish', round: 1, partial: false });
  assert.ok(swissRoundComplete(s.e, 1));
  assert.throws(() => swissPreview(s.e, 2, false), /未收齊/);
  assert.equal(swissPreview(s.e, 2, true).pairs.length, 0);
  fill(s.e, 1);
  s.e.penalties = { t1: 1000 };
  const p = swissPreview(s.e, 2, false);
  assert.ok(p.scores.every((s) => s.score === 10));
  const old = s.e.assignments.map((a) => ({ ...a }));
  s.apply({ action: 'swiss-publish', round: 2, partial: false });
  assert.deepEqual(s.e.assignments.slice(0, old.length), old);
  const seen = new Set<string>();
  for (const a of s.e.assignments.filter((a) => a.room === 'open')) {
    const key = [a.ns, a.ew].sort().join();
    assert.ok(!seen.has(key));
    seen.add(key);
  }
  const pub = s.e.swiss!.publications[1];
  assert.equal(swissBasisChanged(s.e, pub), false);
  const first = s.e.assignments[0];
  s.e.results[resultKey(first.id, first.boards[0])].nsScore = 10000;
  assert.equal(swissBasisChanged(s.e, pub), true);
  assert.deepEqual(s.e.assignments.slice(0, old.length), old);
  assert.throws(() => s.apply({ action: 'swiss-publish', round: 1, partial: false }), /後續/);
});
test('delayed Swiss can publish first two rounds before scores and uses round N-2 only', () => {
  const s = setup(8, 'delayed');
  s.apply({ action: 'swiss-publish', round: 1, partial: false });
  s.apply({ action: 'swiss-publish', round: 2, partial: false });
  assert.equal(s.e.swiss!.publications[1].sourceRound, 0);
  assert.throws(() => swissPreview(s.e, 3, false), /未收齊/);
  fill(s.e, 1);
  assert.equal(swissPreview(s.e, 3, false).sourceRound, 1);
});
test('partial publication excludes unresolved teams, retains legal completion, never infers byes', () => {
  const s = setup(8, 'current');
  s.apply({ action: 'swiss-publish', round: 1, partial: false });
  fill(s.e, 1, new Set(), true);
  s.apply({ action: 'swiss-publish', round: 2, partial: false });
  // Choose one unresolved round-two match; keep everyone else at their exact score.
  const open = s.e.assignments.filter((a) => a.round === 2 && a.room === 'open');
  const previous = swissPreview(s.e, 2, false).scores;
  const pending = open.find(
    (a) =>
      previous.find((s) => s.id === a.ns)!.score === 0 &&
      previous.find((s) => s.id === a.ew)!.score === 0,
  )!;
  assert.ok(pending);
  fill(s.e, 2, new Set([pending.matchId]), true);
  const p = swissPreview(s.e, 3, true);
  assert.ok(
    p.pairs.every(
      ([a, b]) => ![pending.ns, pending.ew].includes(a) && ![pending.ns, pending.ew].includes(b),
    ),
  );
  assert.equal(p.bye, undefined);
  const prior = teamByes(s.e).length;
  assert.ok(p.pairs.length > 0, 'must actually publish before all source results arrive');
  {
    s.apply({ action: 'swiss-publish', round: 3, partial: true });
    assert.equal(teamByes(s.e).length, prior);
    const fixed = s.e.assignments.filter((a) => a.round === 3);
    assert.throws(
      () => s.apply({ action: 'round-control', round: 3, phase: 'playing' }),
      /完整公布/,
    );
    fill(s.e, 3);
    assert.equal(allRoundsComplete(s.e), false);
    assert.throws(() => s.apply({ action: 'settings', status: 'finished' }), /完整公布/);
    fill(
      s.e,
      2,
      new Set(open.filter((a) => a.matchId !== pending.matchId).map((a) => a.matchId)),
      true,
    );
    s.apply({ action: 'swiss-publish', round: 3, partial: false });
    assert.deepEqual(s.e.assignments.filter((a) => a.round === 3).slice(0, fixed.length), fixed);
    assert.ok(swissRoundComplete(s.e, 3));
  }
});
test('matching finds global minimum distance, rejects impossible graphs and scales to 32', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const scores = new Map(ids.map((id, i) => [id, i * 10]));
  assert.equal(matchSwiss(ids, scores, new Set())!.cost, 2000);
  const impossible = new Set(['a\0b', 'a\0c', 'a\0d']);
  assert.equal(matchSwiss(ids, scores, impossible), null);
  const s = setup(32, 'current', 4);
  const start = performance.now();
  for (let r = 1; r <= 4; r++) {
    s.apply({ action: 'swiss-publish', round: r, partial: false });
    fill(s.e, r, new Set(), true);
  }
  console.log(`32-team four-round Swiss lifecycle: ${(performance.now() - start).toFixed(1)}ms`);
  assert.equal(s.e.assignments.length, 128);
});
test('odd Swiss publishes one explicit bye, withholds points until round collected; retries are revision-safe', () => {
  const s = setup(5);
  const c = mutationSchema.parse({
    action: 'swiss-publish',
    round: 1,
    partial: false,
    revision: s.e.revision,
    requestId: randomUUID(),
    reason: 'test',
  });
  const next = applyMutation(s.state, c);
  assert.equal(applyMutation(next, c), next);
  assert.throws(() => applyMutation(next, { ...c, requestId: randomUUID() }), /更新|版本/);
  assert.equal(teamByes(next.event).length, 1);
  assert.equal(project(next.event).byes![0].awarded, false);
  fill(next.event, 1);
  assert.equal(project(next.event).byes![0].awarded, true);
});
