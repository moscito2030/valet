import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/domain/event-factory';
import { project } from '../lib/scoring';
import { audienceEvent } from '../lib/read-models/public-event';
import { createSchema, resultKey, type BridgeEvent, type Result } from '../lib/model';
function fixture(neuberg = true) {
  return createEvent({ name: 'Neuberg test', kind: 'pairs', pairMethod: 'mp', neuberg,
    date: '2026-10-19', venue: '', names: Array.from({ length: 8 }, (_, i) => 'Pair ' + i), rounds: 2, boardsPerRound: 1 });
}
function scores(e: BridgeEvent, board: number, values: number[]) {
  e.assignments.filter(a => a.boards.includes(board)).forEach((a, i) => {
    if (i >= values.length) return;
    const r: Result = { assignmentId: a.id, board, level: 1, strain: 'NT', doubled: 1,
      declarer: 'N', tricks: 7, lead: '', nsScore: values[i], updatedAt: '' };
    e.results[resultKey(a.id, board)] = r;
  });
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, a + ' != ' + b);
test('Neuberg scales unequal board frequencies, ties and standings to a common top', () => {
  const e = fixture();
  e.assignments = e.assignments.filter(a => !(a.round === 2 && a.table === 4));
  scores(e, 1, [400, 300, 200, 100]); scores(e, 2, [400, 400, 100]);
  const p = project(e), rows = e.assignments.filter(a => a.round === 2);
  const first = p.pairScores[resultKey(rows[0].id, 2)];
  near(first.ns!, 13 / 3); near(first.ew!, 5 / 3); assert.equal(first.top, 6);
  assert.equal(first.provisional, false);
  near(p.pairScores[resultKey(rows[2].id, 2)].ns!, 1 / 3);
  for (const standing of p.standings) {
    const played = e.assignments.filter(a => a.ns === standing.id || a.ew === standing.id);
    const sum = played.reduce((n, a) => n + p.pairScores[resultKey(a.id, a.boards[0])][a.ns === standing.id ? 'ns' : 'ew']!, 0);
    near(standing.score!, sum / (played.length * 6) * 100);
  }
  e.neuberg = false;
  const legacy = project(e).pairScores[resultKey(rows[0].id, 2)];
  assert.equal(legacy.ns, 3); assert.equal(legacy.top, 4);
  delete e.neuberg;
  assert.deepEqual(project(e).pairScores[resultKey(rows[0].id, 2)], legacy);
});
test('Neuberg excludes cancelled results, preserves provisional status and does not score a singleton', () => {
  const e = fixture(); scores(e, 1, [400, 300, 200, 100]);
  const rows = e.assignments.filter(a => a.round === 1);
  e.results[resultKey(rows[3].id, 1)].status = 'cancelled';
  let p = project(e);
  near(p.pairScores[resultKey(rows[0].id, 1)].ns!, 17 / 3);
  assert.equal(p.pairScores[resultKey(rows[3].id, 1)].cancelled, true);
  delete e.results[resultKey(rows[2].id, 1)]; p = project(e);
  assert.equal(p.pairScores[resultKey(rows[0].id, 1)].ns, 5);
  assert.equal(p.pairScores[resultKey(rows[0].id, 1)].provisional, true);
  delete e.results[resultKey(rows[1].id, 1)];
  assert.equal(project(e).pairScores[resultKey(rows[0].id, 1)].ns, null);
  e.results = {}; assert.ok(project(e).standings.every(s => s.score === 50));
});
test('Neuberg leaves full fields and IMP methods unchanged; scores split directions separately', () => {
  const e = fixture(); scores(e, 1, [400, 300, 200, 100]);
  assert.deepEqual(project(e), project({ ...e, neuberg: false }));
  const rows = e.assignments.filter(a => a.round === 1);
  delete e.results[resultKey(rows[3].id, 1)];
  const r = e.results[resultKey(rows[0].id, 1)];
  r.split = { ns: { ...r, nsScore: 0 }, ew: { ...r, nsScore: 0 } };
  const p = project(e).pairScores[resultKey(rows[0].id, 1)];
  near(p.ns!, 1 / 3); near(p.ew!, 17 / 3);
  for (const pairMethod of ['butler', 'crossimp'] as const)
    assert.deepEqual(project({ ...e, pairMethod }), project({ ...e, pairMethod, neuberg: false }));
});
test('creation validates Neuberg scope and audience projection retains setting without hidden results', () => {
  const input = { name: 'test', kind: 'pairs' as const, date: '2026-10-19', venue: '', names: ['A','B','C','D'], neuberg: true };
  assert.equal(createEvent(input).neuberg, true);
  assert.equal(createEvent({ ...input, neuberg: undefined }).neuberg, false);
  assert.equal(createSchema.safeParse({ ...input, kind: 'teams' }).success, false);
  assert.equal(createSchema.safeParse({ ...input, pairMethod: 'butler' }).success, false);
  const e = fixture(); scores(e, 1, [400, 300, 200]); scores(e, 2, [100,200,300,400]);
  e.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [1] };
  const publicView = audienceEvent(e);
  assert.equal(publicView.neuberg, true);
  assert.ok(Object.values(publicView.results).every(r => r.board === 1));
  assert.deepEqual(publicView.projection, project({ ...e, results: publicView.results }));
});

test('EBU published 16 expected / 8 actual example matches 29,23,13,5,1 MPs', () => {
  const e = createEvent({ name: 'EBU example', kind: 'pairs', pairMethod: 'mp', neuberg: true,
    date: '2026-10-19', venue: '', names: Array.from({length: 32}, (_, i) => 'Pair ' + i), rounds: 1, boardsPerRound: 1 });
  scores(e, 1, [490,460,460,430,430,430,400,-50]);
  const p = project(e);
  const expected = [29,23,23,13,13,13,5,1];
  e.assignments.slice(0, 8).forEach((a, i) => {
    const score = p.pairScores[resultKey(a.id, 1)];
    assert.equal(score.ns, expected[i]); assert.equal(score.ew, 30 - expected[i]); assert.equal(score.top, 30);
  });
});
