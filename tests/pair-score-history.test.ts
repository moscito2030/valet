import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';
import { audienceEvent } from '../lib/club-view';
import { pairScoreHistory, usesCommonBoards } from '../lib/pair-score-history';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PairScoreChart } from '../components/scoreboard/PairScoreChart';

function fixture() {
  return audienceEvent(createEvent({
    name: 'Common boards', kind: 'pairs', movementPlan: 'double-barometer',
    names: ['A', 'B', 'C', 'D', 'E', 'F'], rounds: 3, boardsPerRound: 1,
    date: '2026-10-20', venue: '',
  }));
}
test('common-board detection uses scheduled boards, independent of movement labels', () => {
  const e = fixture();
  assert.ok(usesCommonBoards(e));
  e.assignments[0].boards = [99];
  assert.equal(usesCommonBoards(e), false);
});
test('IMP accumulates the selected side, preserving gaps and fractional precision', () => {
  const e = fixture();
  e.pairMethod = 'crossimp';
  const a = e.assignments.filter(a => a.ns === 'p1');
  e.projection.pairScores[`${a[0].id}:${a[0].boards[0]}`] = { ns: 1.25, ew: -1.25, top: 4, provisional: true };
  e.projection.pairScores[`${a[2].id}:${a[2].boards[0]}`] = { ns: -2.5, ew: 2.5, top: 4, provisional: false };
  const history = pairScoreHistory(e, 'p1');
  assert.deepEqual(history.map(p => [p.open, p.close]), [[0, 1.25], [1.25, null], [1.25, -1.25]]);
  assert.equal(history[0].provisional, true);
  assert.equal(pairScoreHistory(e, a[0].ew)[0].close, -1.25);
});
test('MP uses cumulative earned MP divided by cumulative top, not the average of percentages', () => {
  const e = fixture();
  const a = e.assignments.filter(a => a.ns === 'p1');
  e.projection.pairScores[`${a[0].id}:${a[0].boards[0]}`] = { ns: 2, ew: 2, top: 4, provisional: false };
  e.projection.pairScores[`${a[1].id}:${a[1].boards[0]}`] = { ns: 2, ew: 0, top: 2, provisional: true };
  e.projection.pairScores[`${a[2].id}:${a[2].boards[0]}`] = { ns: null, ew: null, top: 0, provisional: false, cancelled: true };
  const history = pairScoreHistory(e, 'p1');
  assert.equal(history[0].close, 50);
  assert.equal(history[1].close, 100 * 4 / 6);
  assert.equal(history[2].close, null);
});

test('wicks use the field on the selected side, added to the previous cumulative result', () => {
  const e = fixture();
  const first = e.assignments.filter(a => a.round === 1);
  const second = e.assignments.filter(a => a.round === 2);
  e.pairMethod = 'crossimp';
  first.forEach((a, i) => { e.projection.pairScores[`${a.id}:${a.boards[0]}`] = { ns: [3, -4, 1][i], ew: [-3, 4, -1][i], top: 4, provisional: false }; });
  second.forEach((a, i) => { e.projection.pairScores[`${a.id}:${a.boards[0]}`] = { ns: [-2, 6, -4][i], ew: [2, -6, 4][i], top: 4, provisional: false }; });
  const history = pairScoreHistory(e, 'p1');
  assert.equal(history[0].low, -4);
  assert.equal(history[0].high, 3);
  assert.equal(history[1].low, -1);
  assert.equal(history[1].high, 9);
  const html = renderToStaticMarkup(createElement(PairScoreChart, { event: e, person: 'p1' }));
  assert.match(html, /pair-chart-wick/);
  assert.match(html, /累積.*IMP/);
  assert.match(html, /role="button"/);
  e.assignments[0].boards = [99];
  assert.equal(renderToStaticMarkup(createElement(PairScoreChart, { event: e, person: 'p1' })), '');
});

test('MP wick endpoints use each field result with the accumulated top', () => {
  const e = fixture();
  for (const a of e.assignments.filter(a => a.round === 1)) {
    e.projection.pairScores[`${a.id}:${a.boards[0]}`] = { ns: 2, ew: 2, top: 4, provisional: false };
  }
  e.assignments.filter(a => a.round === 2).forEach((a, i) => {
    e.projection.pairScores[`${a.id}:${a.boards[0]}`] = { ns: [0, 2, 4][i], ew: [4, 2, 0][i], top: 4, provisional: false };
  });
  const p = pairScoreHistory(e, 'p1')[1];
  assert.equal(p.open, 50);
  assert.equal(p.close, 25);
  assert.equal(p.low, 25);
  assert.equal(p.high, 75);
});
