import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Contract } from '../components/scoreboard-shared';
import { agentCommandSchema } from '../lib/agent/commands';
import { adjustedBam, adjustedImps, adjustedMatchpoints, neubergMatchpoints } from '../lib/adjusted-score';
import { directionalDatum } from '../lib/datum';
import { createEvent } from '../lib/domain/event-factory';
import { adjustedGrades, mutationSchema, resultKey, type Assignment, type BridgeEvent, type Result } from '../lib/model';
import { canMutate } from '../lib/mutation-permissions';
import { applyMutation } from '../lib/mutations/apply';
import { audienceEvent } from '../lib/read-models/public-event';
import { project, vp } from '../lib/scoring';
import { seedResultWrites } from '../lib/storage/cell-write';
import { createNormalizedRepository } from '../lib/storage/normalized';
import { saveStage } from '../lib/storage/rows';
import { createTestDb } from './helpers/sql';

function event(kind: BridgeEvent['kind'] = 'pairs') {
  return createEvent({
    kind, name: '裁判測試', venue: '賽場', date: '2026-11-22',
    names: kind === 'pairs' ? ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] : ['T1', 'T2'],
    rounds: 1, boardsPerRound: 2,
  });
}

function played(e: BridgeEvent, assignment: Assignment, board: number, nsScore: number) {
  const result: Result = {
    assignmentId: assignment.id, board, level: 2, strain: 'S', declarer: 'N',
    tricks: 8, lead: 'HK', doubled: 1, nsScore, updatedAt: e.updatedAt,
  };
  e.results[resultKey(assignment.id, board)] = result;
  return result;
}

function stored(e: BridgeEvent) {
  return { event: e, requests: [], projection: project(e) };
}

function award(e: BridgeEvent, assignment = e.assignments[0], board = 1, ns = 'A+', ew = 'A−') {
  return {
    action: 'adjusted-score', revision: e.revision, requestId: randomUUID(),
    reason: '裁定理由', assignmentId: assignment.id, board, award: { ns, ew },
  };
}

test('conversions respect grades, session extrema and BAM scale', () => {
  assert.deepEqual(adjustedGrades.map((grade) => adjustedMatchpoints(grade, 10)), [6, 5, 4]);
  assert.deepEqual(adjustedGrades.map((grade) => adjustedImps(grade)), [3, 0, -3]);
  const scale = { win: 4, draw: 1.5, loss: 0.25 };
  assert.deepEqual(adjustedGrades.map((grade) => adjustedBam(grade, scale)), [4, 1.5, 0.25]);
  assert.equal(adjustedMatchpoints('A+', 10, 0.8), 8);
  assert.equal(adjustedMatchpoints('A−', 10, 0.2), 2);
  assert.equal(adjustedMatchpoints('A', 10, 0.2), 5);
  assert.equal(adjustedMatchpoints('A+', 10, 0.2), 6);
  assert.equal(adjustedMatchpoints('A−', 10, 0.8), 4);
  assert.equal(adjustedImps('A+', 5.5), 5.5);
  assert.equal(adjustedImps('A−', -4.5), -4.5);
  assert.equal(adjustedImps('A', -8), 0);
  assert.equal(adjustedImps('A+', 0), 3);
  assert.equal(adjustedImps('A−', 0), -3);
  assert.equal(neubergMatchpoints(2, 2, 3), 3.5);
});

test('MP factors played tables to the same top, including singleton and all-adjusted fields', () => {
  const e = event();
  const [a, b, c] = e.assignments;
  played(e, b, 1, 100);
  played(e, c, 1, 300);
  const command = mutationSchema.parse(award(e, a));
  const next = applyMutation(stored(e), command);
  const scores = next.projection.pairScores;
  assert.deepEqual(scores[resultKey(a.id, 1)], { ns: 2.4, ew: 1.6, top: 4, provisional: false });
  assert.equal(scores[resultKey(b.id, 1)].ns, 0.5);
  assert.equal(scores[resultKey(c.id, 1)].ns, 3.5);
  const one = applyMutation(next, mutationSchema.parse(award(next.event, b, 1, 'A+', 'A+')));
  assert.equal(one.projection.pairScores[resultKey(c.id, 1)].ns, 2);
  const none = applyMutation(one, mutationSchema.parse(award(one.event, c)));
  assert.equal(none.projection.pairScores[resultKey(a.id, 1)].top, 4);
  assert.equal(none.projection.pairScores[resultKey(b.id, 1)].ew, 2.4);
  assert.equal(none.projection.pairScores[resultKey(c.id, 1)].provisional, false);
  assert.equal(none.projection.pairScores[resultKey(a.id, 2)], undefined);
});

for (const method of ['mp', 'crossimp', 'butler'] as const) {
  test(`${method}: 12C2(c) uses only played scores and excludes awards from comparisons`, () => {
    const e = event();
    e.pairMethod = method;
    const [a, b, c] = e.assignments;
    played(e, b, 1, 100);
    played(e, c, 1, 300);
    played(e, a, 2, 900);
    played(e, b, 2, 0);
    played(e, c, 2, 0);
    e.penalties = { [a.ns]: 1 };
    const next = applyMutation(stored(e), mutationSchema.parse(award(e, a)));
    const scores = next.projection.pairScores;
    const base = project({ ...next.event, adjustedSession: false }).pairScores;
    const key = resultKey(a.id, 1);
    if (method === 'mp') {
      assert.equal(base[key].ns, 2.4);
      assert.equal(base[key].ew, 1.6);
      assert.equal(scores[key].ns, 4);
      assert.equal(scores[key].ew, 0);
      assert.equal(next.projection.standings.find((p) => p.id === a.ns)?.score, 99);
    } else {
      assert.equal(base[key].ns, 3);
      assert.equal(base[key].ew, -3);
      assert.equal(scores[key].ns, method === 'crossimp' ? 14 : 12);
      assert.equal(scores[key].ew, -scores[key].ns!);
      assert.equal(scores[resultKey(b.id, 1)].ns, method === 'crossimp' ? -5 : -3);
      assert.equal(scores[resultKey(b.id, 1)].datum, method === 'crossimp' ? undefined : 200);
      assert.equal(directionalDatum(Object.values(next.event.results).filter((r) => r.board === 1)).ns.datum, 200);
      assert.equal(next.projection.standings.find((p) => p.id === a.ns)?.score, 2 * scores[key].ns! - 1);
    }
  });
}

test('teams count the two rooms once and convert independent signed IMP margins to VP', () => {
  const e = event('teams');
  const [open, closed] = e.assignments;
  assert.equal(open.room, 'open');
  played(e, open, 2, 100);
  played(e, closed, 2, 100);
  const next = applyMutation(stored(e), mutationSchema.parse(award(e, closed, 1, 'A+', 'A+')));
  const [match] = next.projection.matches;
  assert.equal(match.completed, 2);
  assert.equal(match.marginA, 3);
  assert.equal(match.marginB, 3);
  assert.equal(match.vpA, vp(3, 2));
  assert.equal(match.vpB, vp(3, 2));
  assert.equal(match.split, true);
  const oriented = applyMutation(next, mutationSchema.parse(award(next.event, closed)));
  assert.deepEqual(oriented.event.results[resultKey(open.id, 1)].adjusted, { ns: 'A−', ew: 'A+' });
  assert.equal(oriented.projection.matches[0].vpA, vp(-3, 2));
  assert.equal(oriented.projection.matches[0].vpB, vp(3, 2));
  const bam = project({ ...oriented.event, teamMethod: 'bam', bam: { win: 3, draw: 1.5, loss: 0.25 } });
  assert.deepEqual([bam.matches[0].vpA, bam.matches[0].vpB], [1.75, 4.5]);
  const clear = applyMutation(oriented, mutationSchema.parse({ ...award(oriented.event, open), award: null }));
  assert.equal(clear.event.results[resultKey(open.id, 1)], undefined);
  assert.equal(clear.event.results[resultKey(closed.id, 1)], undefined);
});

test('adjusted-score permission, validation, replay, clear and audit trail', () => {
  const e = event();
  const [a] = e.assignments;
  const original = played(e, a, 1, 110);
  const input = award(e);
  const command = mutationSchema.parse(input);
  assert.equal(canMutate('director', command), true);
  assert.equal(canMutate('admin', command), false);
  assert.equal(canMutate(null, command), false);
  assert.equal(agentCommandSchema.safeParse({ requestId: command.requestId, command }).success, false);
  assert.equal(mutationSchema.safeParse({ ...input, reason: undefined }).success, false);
  assert.equal(mutationSchema.safeParse({ ...input, award: null, reason: ' 一 ' }).success, false);
  assert.equal(mutationSchema.safeParse({ ...input, reason: '長'.repeat(201) }).success, false);
  assert.equal(mutationSchema.safeParse({ ...input, award: { ns: 'A+', ew: 'B' } }).success, false);
  const next = applyMutation(stored(e), command);
  const key = resultKey(a.id, 1);
  const adjusted = next.event.results[key];
  assert.equal(adjusted.status, 'adjusted');
  assert.deepEqual(next.event.audit.at(-1)?.changes, [{ key, before: original, after: adjusted }]);
  assert.equal(next.event.audit.at(-1)?.reason, '裁定理由');
  assert.equal(applyMutation(next, command), next);
  assert.throws(() => applyMutation(next, mutationSchema.parse({ ...input, requestId: randomUUID() })), { status: 409 });
  const { assignmentId, board } = original;
  const nearby = { revision: next.event.revision, requestId: randomUUID(), assignmentId, board };
  assert.throws(() => applyMutation(next, mutationSchema.parse({ ...nearby, action: 'clear-result' })), { status: 403 });
  assert.throws(() => applyMutation(next, mutationSchema.parse({ ...nearby, action: 'ruling', cancelled: true })), { status: 403 });
  const { level, strain, doubled, declarer, tricks, lead } = original;
  assert.throws(() => applyMutation(next, mutationSchema.parse({
    revision: nearby.revision, requestId: nearby.requestId, action: 'results',
    results: [{ assignmentId, board, level, strain, doubled, declarer, tricks, lead }],
  })), { status: 403 });
  const clear = mutationSchema.parse({ ...award(next.event), award: null });
  assert.equal(canMutate('admin', clear), false);
  const restored = applyMutation(next, clear);
  const after = restored.event.results[key];
  assert.deepEqual(after, { ...original, updatedAt: after.updatedAt });
  assert.equal(restored.event.audit.at(-1)?.action, '撤銷調整分');
  assert.deepEqual(restored.event.audit.at(-1)?.changes, [{ key, before: adjusted, after }]);
  assert.deepEqual(restored.event.boards, e.boards);
});

test('normalized PGlite round trip, public publication gate and adjusted contract display', async () => {
  const e = event();
  const [a, b, c] = e.assignments;
  const key = resultKey(a.id, 1);
  played(e, b, 1, 300);
  played(e, c, 1, 500);
  e.boards[0].published = true;
  const db = await createTestDb();
  try {
    await saveStage(db.sql, stored(e), seedResultWrites(e));
    const repo = createNormalizedRepository(db.sql);
    const command = mutationSchema.parse(award(e));
    const readBoardRows = () => db.sql`SELECT xmin::text, document_json FROM bridge_boards WHERE event_id = ${e.id} ORDER BY ordinal`;
    const boardsBefore = await readBoardRows();
    const next = await repo.mutateEvent(e.id, command);
    const reread = await repo.getEvent(e.id);
    assert.deepEqual(reread.event.results[key], next.event.results[key]);
    assert.deepEqual(reread.event.audit.at(-1)?.changes, next.event.audit.at(-1)?.changes);
    assert.equal((await repo.mutateEvent(e.id, command)).event.revision, reread.event.revision);
    assert.throws(() => applyMutation(reread, mutationSchema.parse(award(e))), { status: 409 });
    const privateView = structuredClone(reread.event);
    privateView.boards[0].published = false;
    const hidden = audienceEvent(privateView, reread.projection);
    assert.equal(hidden.results[key], undefined);
    assert.equal(hidden.projection.pairScores[key], undefined);
    const view = audienceEvent(reread.event, reread.projection);
    assert.equal('audit' in view, false);
    assert.deepEqual(view.results[key].adjusted, { ns: 'A+', ew: 'A−' });
    const html = renderToStaticMarkup(createElement(Contract, { result: view.results[key] }));
    assert.match(html, /調整分 NS A\+ \/ EW A−/);
    assert.doesNotMatch(html, /Pass|待收分/);
    assert.match(renderToStaticMarkup(createElement(Contract)), /待收分/);
    const clear = mutationSchema.parse({ ...award(reread.event), award: null });
    await repo.mutateEvent(e.id, clear);
    const cleared = await repo.getEvent(e.id);
    assert.equal(cleared.event.results[key], undefined);
    assert.equal(cleared.event.audit.at(-1)?.changes?.[0].after, null);
    assert.deepEqual(cleared.event.boards, reread.event.boards);
    assert.deepEqual(await readBoardRows(), boardsBefore);
  } finally {
    await db.close();
  }
});
