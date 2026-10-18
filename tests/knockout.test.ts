import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, resultKey, type BridgeEvent } from '../lib/model';
import { project } from '../lib/scoring';
import {
  seedKnockout,
  validateKnockout,
  currentKnockoutScore,
  assertKnockoutDecisions,
} from '../lib/knockout';
import { teamByes } from '../lib/team-movement';
import { audienceEvent } from '../lib/read-models/public-event';
import { canMutate } from '../lib/mutation-permissions';
function fixture(count = 4, bam = false) {
  return createEvent({
    name: 'KO',
    kind: 'teams',
    teamMethod: bam ? 'bam' : 'imp',
    names: Array.from({ length: count }, (_, i) => 'Team ' + i),
    date: '2026-10-19',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
}
function apply(e: BridgeEvent, input: object) {
  return applyMutation(
    { event: e, projection: project(e), requests: [] },
    mutationSchema.parse({
      revision: e.revision,
      requestId: randomUUID(),
      reason: '測試淘汰賽',
      ...input,
    }),
  ).event;
}
function setup(count = 4, legs = 1, bam = false) {
  let e = fixture(count, bam);
  e = apply(e, {
    action: 'knockout-config',
    nodes: seedKnockout(
      e.participants.map((p) => p.id),
      legs,
      1,
      true,
    ),
  });
  return apply(e, { action: 'knockout-publish' });
}
function fill(e: BridgeEvent) {
  for (const a of e.assignments)
    for (const board of a.boards)
      e.results[resultKey(a.id, board)] = {
        assignmentId: a.id,
        board,
        level: 1,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 7,
        lead: '',
        nsScore: a.room === 'open' ? 420 : 0,
        updatedAt: '',
      };
}
test('seeded semifinals feed winners to final and losers to bronze; final places remain explicit', () => {
  let e = setup();
  fill(e);
  for (const id of ['s1m1', 's1m2']) e = apply(e, { action: 'knockout-decide', nodeId: id });
  e = apply(e, { action: 'knockout-publish' });
  assert.equal(e.assignments.length, 8);
  assert.equal(e.knockout!.published.s2m1.a, e.knockout!.decisions.s1m1.winner);
  assert.equal(e.knockout!.published.bronze.a, e.knockout!.decisions.s1m1.loser);
  assert.equal(e.knockout!.nodes.find((n) => n.id === 'bronze')!.winnerPlace, 3);
  assert.equal('basis' in audienceEvent(e).knockout!.decisions.s1m1, false);
  assert.throws(
    () => apply(e, { action: 'knockout-config', nodes: e.knockout!.nodes }),
    /不能重建/,
  );
});
test('five teams seed byes advance without scores or invented bye VP', () => {
  const e = setup(5);
  assert.equal(Object.values(e.knockout!.decisions).length, 3);
  assert.deepEqual(teamByes(e), []);
  assert.ok(project(e).standings.every((s) => s.score === 0));
  assert.ok(e.knockout!.published.s2m2);
});
test('multi-leg IMP aggregates raw margins; BAM aggregates board VP', () => {
  for (const bam of [false, true]) {
    let e = setup(4, 2, bam);
    fill(e);
    const n = e.knockout!.nodes[0],
      s = currentKnockoutScore(e, n);
    assert.equal(s.complete, true);
    assert.equal(s.a, bam ? 4 : 18);
    e = apply(e, { action: 'knockout-decide', nodeId: n.id });
    assert.equal(e.knockout!.decisions[n.id].winner, e.knockout!.published[n.id].a);
  }
});
test('unfinished matches cannot advance; ties require explicit director choice', () => {
  let e = setup();
  assert.throws(() => apply(e, { action: 'knockout-decide', nodeId: 's1m1' }), /尚未收齊/);
  fill(e);
  for (const r of Object.values(e.results)) r.nsScore = 0;
  assert.throws(() => apply(e, { action: 'knockout-decide', nodeId: 's1m1' }), /平手/);
  const winner = e.knockout!.published.s1m1.b!;
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1', winner });
  assert.equal(e.knockout!.decisions.s1m1.winner, winner);
});
test('confirmed scores are immutable until reopened; started downstream matches block reopen', () => {
  let e = setup();
  fill(e);
  for (const id of ['s1m1', 's1m2']) e = apply(e, { action: 'knockout-decide', nodeId: id });
  const changed = structuredClone(e);
  Object.values(changed.results)[0].nsScore = 100;
  assert.throws(() => assertKnockoutDecisions(changed), /撤回/);
  e = apply(e, { action: 'knockout-publish' });
  const reopened = apply(e, { action: 'knockout-reopen', nodeId: 's1m1' });
  assert.equal(reopened.knockout!.published.s2m1, undefined);
  assert.equal(reopened.assignments.length, 4);
  fill(e);
  assert.throws(() => apply(e, { action: 'knockout-reopen', nodeId: 's1m1' }), /後續對局已有成績/);
});
test('bracket rejects duplicate feeds, cycles, overlapping tables and excessive player boards', () => {
  const e = fixture();
  const base = seedKnockout(
    e.participants.map((p) => p.id),
    1,
    8,
    true,
  );
  validateKnockout(base, e);
  for (const edit of [
    (n: typeof base) => {
      n[1].a = n[0].a;
    },
    (n: typeof base) => {
      n[0].a = { kind: 'winner', id: n[2].id };
    },
    (n: typeof base) => {
      n[1].table = n[0].table;
    },
    (n: typeof base) => {
      n[2].startRound = 1;
    },
  ]) {
    const nodes = structuredClone(base);
    edit(nodes);
    assert.throws(() => validateKnockout(nodes, e));
  }
  assert.throws(
    () =>
      validateKnockout(
        seedKnockout(
          e.participants.map((p) => p.id),
          33,
          16,
        ),
        e,
      ),
    /1024/,
  );
  validateKnockout(
    seedKnockout(
      e.participants.map((p) => p.id),
      32,
      16,
    ),
    e,
  );
});
test('club unpublished scores cannot decide a match or leak into spectator scores', () => {
  let e = setup();
  fill(e);
  e.club = { enabled: true, mode: 'table', tokens: {}, confirmations: {}, finalized: [] };
  assert.throws(() => apply(e, { action: 'knockout-decide', nodeId: 's1m1' }), /結算/);
  assert.equal(
    currentKnockoutScore({ ...e, results: audienceEvent(e).results }, e.knockout!.nodes[0])
      .complete,
    false,
  );
  e.club.finalized = [1];
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1' });
  assert.ok(e.knockout!.decisions.s1m1);
});
test('only directors manage knockout decisions', () => {
  const c = mutationSchema.parse({
    action: 'knockout-publish',
    revision: 1,
    requestId: randomUUID(),
    reason: '公布對戰',
  });
  assert.equal(canMutate('admin', c), false);
  assert.equal(canMutate('director', c), true);
});

test('score mutation cannot silently change confirmed knockout advancement', () => {
  let e = setup();
  fill(e);
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1' });
  const a = e.assignments.find((a) => a.matchId === 'ko-s1m1-r1')!;
  assert.throws(
    () => apply(e, { action: 'clear-result', assignmentId: a.id, board: a.boards[0] }),
    /撤回/,
  );
  e = apply(e, { action: 'knockout-reopen', nodeId: 's1m1' });
  e = apply(e, { action: 'clear-result', assignmentId: a.id, board: a.boards[0] });
  assert.equal(e.results[resultKey(a.id, a.boards[0])], undefined);
});
