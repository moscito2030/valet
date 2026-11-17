import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';
import { audienceEvent } from '../lib/club-view';
import { buildMovement } from '../lib/movement-plans';
import { boardButlerVolume, pairScoreHistory } from '../lib/pair-score-history';
import type { Result } from '../lib/model';
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
test('Butler volume counts each table once and averages absolute split awards', () => {
  const event = fixture();
  const assignments = event.assignments.filter(a => a.round === 1);
  const board = assignments[0].boards[0];
  const result = (assignmentId: string, nsScore: number): Result => ({ assignmentId, board, level: 4, strain: 'S', doubled: 1, declarer: 'N', tricks: 10, lead: '', nsScore, updatedAt: '' });
  event.results[`${assignments[0].id}:${board}`] = result(assignments[0].id, 420);
  event.results[`${assignments[1].id}:${board}`] = result(assignments[1].id, 0);
  assert.deepEqual(boardButlerVolume(event, board), { value: 10, spread: 10, tables: 2, provisional: true });
  event.results[`${assignments[0].id}:${board}`].split = {
    ns: result(assignments[0].id, 1000), ew: result(assignments[0].id, 0),
  };
  assert.equal(boardButlerVolume(event, board).value, 22 / 2);
  event.results[`${assignments[2].id}:${board}`] = { ...result(assignments[2].id, 9999), status: 'cancelled' };
  assert.deepEqual(boardButlerVolume(event, board), { value: 11, spread: 22, tables: 2, provisional: false });
  assert.equal(boardButlerVolume(event, 999).value, null);
});

test('table hover highlights the matching candle and clears without an external hover', () => {
  const event = fixture();
  const a = event.assignments.find(a => a.ns === 'p1')!;
  const board = a.boards[0];
  event.projection.pairScores[`${a.id}:${board}`] = { ns: 2, ew: 2, top: 4, provisional: false };
  const render = (hoveredBoard: number | null) => renderToStaticMarkup(createElement(PairScoreChart, { event, person: 'p1', hoveredBoard }));
  assert.doesNotMatch(render(board), /<(?:details|summary)\b/);
  assert.match(render(board), /popoverTarget="[^"]+"[^>]*aria-label="累積 MP% 計分說明"/);
  assert.match(render(board), /popover="auto"[^>]*aria-label="K 棒計分說明"/);
  assert.match(render(board), /pair-chart-crosshair/);
  assert.match(render(board), /pair-chart-candle flat selected/);
  assert.doesNotMatch(render(null), /pair-chart-crosshair/);
  assert.doesNotMatch(render(null), /pair-chart-candle flat selected/);
});

test('common-board history stays in board order, including boards listed backwards in a round', () => {
  const e = fixture();
  assert.deepEqual(pairScoreHistory(e, 'p1').map(p => [p.round, p.board]), [[1, 1], [2, 2], [3, 3]]);
  const wider = audienceEvent(createEvent({
    name: 'Common boards', kind: 'pairs', movementPlan: 'double-barometer',
    names: ['A', 'B', 'C', 'D', 'E', 'F'], rounds: 2, boardsPerRound: 2,
    date: '2026-10-20', venue: '',
  }));
  for (const assignment of wider.assignments) assignment.boards.reverse();
  assert.deepEqual(pairScoreHistory(wider, 'p1').map(p => [p.round, p.board]), [[1, 1], [1, 2], [2, 3], [2, 4]]);
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
  assert.match(renderToStaticMarkup(createElement(PairScoreChart, { event: e, person: 'p1' })), /逐副累積成績 K 棒/);
});

test('Howell movement renders candles in the order a pair played the boards, with cross-round wicks', () => {
  const raw = createEvent({
    name: 'Howell', kind: 'pairs', names: ['A', 'B', 'C', 'D', 'E', 'F'],
    rounds: 5, boardsPerRound: 1, date: '2026-11-16', venue: '',
  });
  const plan = buildMovement(raw, 'howell-3-5');
  raw.assignments = plan.assignments;
  raw.participants = plan.participants;
  const e = audienceEvent(raw);
  e.pairMethod = 'crossimp';
  const played = (board: number) => e.assignments.filter(a => a.boards.includes(board));
  const score = (assignmentId: string, board: number, ns: number, ew: number) => {
    e.projection.pairScores[`${assignmentId}:${board}`] = { ns, ew, top: 4, provisional: false };
  };
  // p1 sits EW on board 1 (round 1) and board 4 (round 2). Board-number order would be 1, 2, 3, 4, 5.
  for (const a of played(1)) score(a.id, 1, a.ew === 'p1' ? -3 : a.ew === 'p2' ? 4 : -1, a.ew === 'p1' ? 3 : a.ew === 'p2' ? -4 : 1);
  for (const a of played(4)) score(a.id, 4, a.ew === 'p1' ? -5 : a.ew === 'p5' ? 2 : 1, a.ew === 'p1' ? 5 : a.ew === 'p5' ? -2 : -1);
  for (const a of played(4)) {
    e.results[`${a.id}:4`] = {
      assignmentId: a.id, board: 4, level: 4, strain: 'S', doubled: 1, declarer: 'N', tricks: 10, lead: '', nsScore: 420, updatedAt: '',
    };
  }
  const history = pairScoreHistory(e, 'p1');
  assert.deepEqual(history.map(p => [p.round, p.board]), [[1, 1], [2, 4], [3, 2], [4, 3], [5, 5]]);
  assert.notDeepEqual(history.map(p => p.board), [...history.map(p => p.board)].sort((a, b) => a - b));
  assert.deepEqual([history[0].open, history[0].close, history[0].low, history[0].high], [0, 3, -4, 3]);
  assert.deepEqual([history[1].open, history[1].close, history[1].low, history[1].high], [3, 8, 1, 8]);
  assert.equal(played(4).map(a => a.round).sort((a, b) => a - b).join(','), '1,2,4');
  assert.deepEqual(boardButlerVolume(e, 4), { value: 0, spread: 0, tables: 3, provisional: false });
  const html = renderToStaticMarkup(createElement(PairScoreChart, { event: e, person: 'p1' }));
  assert.match(html, /逐副累積成績 K 棒/);
  assert.match(html, /pair-chart-wick/);
  assert.deepEqual([...html.matchAll(/aria-label="牌 (\d+)：/g)].map(m => Number(m[1])), [1, 4, 2, 3, 5]);
  assert.deepEqual([...html.matchAll(/pair-chart-round-label"[^>]*>(\d+)</g)].map(m => Number(m[1])), [1, 2, 3, 4, 5]);
  assert.equal((html.match(/class="pair-chart-round"/g) ?? []).length, 4);
  assert.match(html, />圈數</);
  assert.doesNotMatch(html, /牌號/);
  assert.match(html, /<strong>牌 4<\/strong>/);
});

test('round axis labels each round once and keeps the board number in the detail', () => {
  const e = audienceEvent(createEvent({
    name: 'Common boards', kind: 'pairs', movementPlan: 'double-barometer',
    names: ['A', 'B', 'C', 'D', 'E', 'F'], rounds: 2, boardsPerRound: 2,
    date: '2026-10-20', venue: '',
  }));
  for (const assignment of e.assignments.filter(a => a.ns === 'p1')) {
    for (const board of assignment.boards) {
      e.projection.pairScores[`${assignment.id}:${board}`] = { ns: 2, ew: 2, top: 4, provisional: false };
    }
  }
  const html = renderToStaticMarkup(createElement(PairScoreChart, { event: e, person: 'p1', hoveredBoard: 2 }));
  assert.deepEqual([...html.matchAll(/pair-chart-round-label"[^>]*>(\d+)</g)].map(m => Number(m[1])), [1, 2]);
  assert.equal((html.match(/class="pair-chart-round"/g) ?? []).length, 1);
  assert.match(html, />圈數</);
  assert.doesNotMatch(html, /牌號/);
  assert.match(html, /<strong>牌 2<\/strong>/);
  assert.match(html, /pair-chart-crosshair[\s\S]*?>1</);
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
