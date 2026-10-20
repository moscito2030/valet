import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';
import { audienceEvent } from '../lib/club-view';
import { pairScoreHistory, roundMovingAverage, usesCommonBoards } from '../lib/pair-score-history';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PairScoreChart } from '../components/scoreboard/PairScoreChart';

test('round MA waits for a full window and breaks across missing results', () => {
  const points = [10, 20, 30, null, 40, 60].map(close => ({ close }));
  assert.deepEqual(roundMovingAverage(points, 2), [null, 15, 25, null, null, 50]);
  assert.deepEqual(roundMovingAverage(points, 1), [10, 20, 30, null, 40, 60]);
});

function fixture() {
  return audienceEvent(createEvent({
    name: 'Common boards', kind: 'pairs', movementPlan: 'double-barometer',
    names: ['A', 'B', 'C', 'D', 'E', 'F'], rounds: 3, boardsPerRound: 1,
    date: '2026-10-20', venue: '',
  }));
}
test('table hover highlights the matching candle and clears without an external hover', () => {
  const event = fixture();
  const a = event.assignments.find(a => a.ns === 'p1')!;
  const board = a.boards[0];
  event.projection.pairScores[`${a.id}:${board}`] = { ns: 2, ew: 2, top: 4, provisional: false };
  const render = (hoveredBoard: number | null) => renderToStaticMarkup(createElement(PairScoreChart, { event, person: 'p1', hoveredBoard }));
  assert.match(render(board), /pair-chart-crosshair/);
  assert.match(render(board), /pair-chart-candle flat selected/);
  assert.doesNotMatch(render(null), /pair-chart-crosshair/);
  assert.doesNotMatch(render(null), /pair-chart-candle flat selected/);
});

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
  assert.equal(history[2].close, history[1].close);
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

test('chart axes stay centered on neutral with integer symmetric ticks for fractional scores', () => {
  for (const method of ['mp', 'crossimp'] as const) {
    const e = fixture();
    e.pairMethod = method;
    const a = e.assignments.find(a => a.ns === 'p1')!;
    e.projection.pairScores[`${a.id}:${a.boards[0]}`] = { ns: 1.25, ew: 2.75, top: 4, provisional: false };
    const html = renderToStaticMarkup(createElement(PairScoreChart, { event: e, person: 'p1' }));
    assert.match(html, /y1="110" y2="110" class="pair-chart-baseline"/);
    const ticks = [...html.matchAll(/<text [^>]*class="pair-chart-label pair-chart-tick"[^>]*>([^<]+)<\/text>/g)].map(m => Number(m[1]));
    const base = method === 'mp' ? 50 : 0;
    assert.equal(ticks.length, 5);
    assert.ok(ticks.every(Number.isInteger));
    assert.equal(ticks[2], base);
    assert.equal(ticks[0] - base, base - ticks[4]);
  }
});

test('cancelled boards retain field wicks without changing accumulated IMP or MP', () => {
  for (const method of ['mp', 'crossimp'] as const) {
    const e = fixture();
    e.pairMethod = method;
    const a = e.assignments.find(a => a.round === 1 && a.ns === 'p1')!;
    e.projection.pairScores[`${a.id}:${a.boards[0]}`] = { ns: null, ew: null, top: 0, provisional: false, cancelled: true };
    const others = e.assignments.filter(other => other.round === 1 && other.id !== a.id);
    others.forEach((other, i) => {
      e.projection.pairScores[`${other.id}:${other.boards[0]}`] = {
        ns: method === 'mp' ? i * 2 : [-3, 3][i],
        ew: method === 'mp' ? 2 - i * 2 : [3, -3][i],
        top: 2, provisional: false,
      };
    });
    const p = pairScoreHistory(e, 'p1')[0];
    assert.equal(p.close, method === 'mp' ? 50 : 0);
    assert.equal(p.low, method === 'mp' ? 0 : -3);
    assert.equal(p.high, method === 'mp' ? 100 : 3);
    const html = renderToStaticMarkup(createElement(PairScoreChart, { event: e, person: 'p1' }));
    assert.match(html, /pair-chart-wick/);
    assert.match(html, /取消牌，不計入累積/);
  }
});
