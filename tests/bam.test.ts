import { canMutate } from '../lib/mutation-permissions';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import {
  createSchema,
  mutationSchema,
  resultKey,
  type BridgeEvent,
  type Result,
  type StoredEvent,
} from '../lib/model';
import { project, teamBoardImps, teamBoardPoints, teamStandingsThroughRound } from '../lib/scoring';
import { bamBoardPoints } from '../lib/team-method';
import { audienceEvent } from '../lib/read-models/public-event';
import { eventIndex } from '../lib/event-index';
import { stageSummary } from '../lib/competitions';
import { duplicateStage } from '../lib/domain/duplicate-stage';
import { interleavedAssignments } from '../lib/team-movement';
import { swissPreview } from '../lib/swiss';
import { winAwardStats } from '../lib/win-awards';
const raw = (score: number): Result => ({
  assignmentId: 'a',
  board: 1,
  level: 1,
  strain: 'NT',
  doubled: 1,
  declarer: 'N',
  tricks: 7,
  lead: '',
  nsScore: score,
  updatedAt: '',
});
function fixture() {
  return createEvent({
    name: 'BAM test',
    kind: 'teams',
    teamMethod: 'bam',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-10-19',
    venue: '',
    rounds: 1,
    boardsPerRound: 3,
  });
}
function fill(e: BridgeEvent) {
  for (const a of e.assignments)
    for (const board of a.boards)
      e.results[resultKey(a.id, board)] = {
        ...raw(a.room === 'closed' ? 100 : board % 3 === 1 ? 110 : board % 3 === 2 ? 100 : 90),
        assignmentId: a.id,
        board,
      };
}
function apply(e: BridgeEvent, input: object): StoredEvent {
  return applyMutation(
    { event: e, projection: project(e), requests: [] },
    mutationSchema.parse({
      action: 'settings',
      ...('action' in input ? {} : { status: 'live' }),
      revision: e.revision,
      requestId: randomUUID(),
      reason: 'BAM settings',
      ...input,
    }),
  );
}
test('BAM uses raw differences including 10 points; custom win/draw/loss and split awards', () => {
  assert.deepEqual(teamBoardImps(raw(110), raw(100)), [0, -0]);
  assert.deepEqual(bamBoardPoints(raw(110), raw(100), {}), [2, 0]);
  assert.deepEqual(bamBoardPoints(raw(100), raw(100), {}), [1, 1]);
  assert.deepEqual(bamBoardPoints(raw(90), raw(100), {}), [0, 2]);
  const scoring = { teamMethod: 'bam' as const, bam: { win: 3, draw: 0.5, loss: 0.25 } };
  assert.deepEqual(teamBoardPoints(raw(110), raw(100), scoring), [3, 0.25]);
  const r = raw(100);
  r.split = { ns: raw(110), ew: raw(90) };
  assert.deepEqual(bamBoardPoints(r, raw(100), scoring), [3, 3]);
  assert.deepEqual(bamBoardPoints({ ...r, status: 'cancelled' }, raw(100), scoring), [0, 0]);
});
test('BAM sums board VP, ignores IMP magnitude, applies penalties only to final standings', () => {
  const e = fixture();
  fill(e);
  e.bam = { win: 3, draw: 0.5, loss: 0.25 };
  const p = project(e);
  assert.ok(p.matches.every((m) => m.vpA === 3.75 && m.vpB === 3.75));
  assert.ok(p.standings.every((s) => s.score === 3.75));
  const open = e.assignments.find((a) => a.room === 'open')!;
  e.results[resultKey(open.id, 3)].nsScore = -2000;
  const withLoss = project(e);
  assert.equal(withLoss.matches[0].vpA, 3.75);
  e.penalties = { [open.ns]: 1 };
  const penalized = project(e);
  assert.equal(penalized.standings.find((s) => s.id === open.ns)!.score, 2.75);
  assert.equal(
    teamStandingsThroughRound({ ...e, projection: penalized }, 1).find((s) => s.id === open.ns)!
      .score,
    3.75,
  );
  assert.ok(winAwardStats({ ...e, projection: penalized }).every((r) => r.draw === 1));
});
test('BAM pending/cancelled results and zero awards do not invent draws or scores', () => {
  const e = fixture();
  fill(e);
  const a = e.assignments[0],
    key = resultKey(a.id, 1);
  delete e.results[key];
  assert.equal(project(e).matches[0].vpA, null);
  fill(e);
  e.results[key].status = 'cancelled';
  assert.equal(project(e).matches[0].vpA, 1);
  for (const r of Object.values(e.results)) r.status = 'cancelled';
  assert.ok(project(e).matches.every((m) => m.vpA === null));
  fill(e);
  e.bam = { win: 0, draw: 0, loss: 0 };
  assert.ok(project(e).matches.every((m) => m.vpA === 0));
});
test('BAM schema, settings locks, clone, audience and competition summaries preserve method', () => {
  const e = fixture();
  assert.deepEqual(e.bam, { win: 2, draw: 1, loss: 0 });
  const saved = apply(e, { bam: { win: 4, draw: 2, loss: 0 } });
  assert.equal(audienceEvent(saved.event).teamMethod, 'bam');
  assert.deepEqual(duplicateStage(saved.event, 'copy').bam, saved.event.bam);
  assert.equal(stageSummary(eventIndex(saved).event).teamMethod, 'bam');
  fill(e);
  assert.throws(() => apply(e, { bam: { win: 4, draw: 2, loss: 0 } }), /不能變更/);
  const input = {
    name: 'test',
    kind: 'pairs',
    teamMethod: 'bam',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-10-19',
    venue: '',
  };
  assert.equal(createSchema.safeParse(input).success, false);
  for (const win of [-1, Infinity, 10001, 0.001])
    assert.equal(
      createSchema.safeParse({ ...input, kind: 'teams', bam: { win, draw: 1, loss: 0 } }).success,
      false,
    );
  const legacy = { ...fixture(), teamMethod: undefined, bam: undefined };
  fill(legacy);
  assert.deepEqual(project(legacy), project({ ...legacy, teamMethod: 'imp' }));
});
test('BAM unpublished club results remain private and interleaved compares each board once', () => {
  const e = fixture();
  fill(e);
  e.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [] };
  assert.ok(audienceEvent(e).projection.matches.every((m) => m.vpA === null));
  e.club.finalized = [1];
  assert.ok(audienceEvent(e).projection.matches.every((m) => m.vpA === 3));
  const triangle = createEvent({
    name: 'BAM triangle',
    kind: 'teams',
    teamMethod: 'bam',
    names: ['A', 'B', 'C'],
    date: '2026-10-19',
    venue: '',
    rounds: 2,
    boardsPerRound: 1,
  });
  triangle.assignments = interleavedAssignments(triangle, 3);
  triangle.teamMovement = 'interleaved';
  fill(triangle);
  const p = project(triangle);
  assert.equal(p.matches.length, 3);
  assert.ok(p.matches.every((m) => m.round === 2 && m.vpA! + m.vpB! === 2));
});
test('Swiss pairing reads BAM VP and allows explicitly configured BAM bye above 20', () => {
  let e = fixture();
  e = apply(e, {
    action: 'swiss-config',
    mode: 'current',
    rounds: 3,
    boardsPerRound: 3,
    byeVp: 24,
  }).event;
  e = apply(e, { action: 'swiss-publish', round: 1, partial: false }).event;
  fill(e);
  const next = swissPreview(e, 2, false);
  assert.ok(next.scores.every((s) => s.score === 3));
  assert.throws(() => apply(e, { teamMethod: 'imp' }), /不能變更/);
  const imp = { ...fixture(), teamMethod: 'imp' as const };
  assert.throws(
    () =>
      apply(imp, {
        action: 'swiss-config',
        mode: 'current',
        rounds: 3,
        boardsPerRound: 3,
        byeVp: 24,
      }),
    /不可超過 20/,
  );
});

test('only directors can change team scoring settings', () => {
  const cmd = mutationSchema.parse({ action:'settings', status:'live', revision:1, requestId:randomUUID(), reason:'修改 BAM', teamMethod:'bam', bam:{win:2,draw:1,loss:0} });
  assert.equal(canMutate('admin',cmd),false); assert.equal(canMutate('director',cmd),true);
});

