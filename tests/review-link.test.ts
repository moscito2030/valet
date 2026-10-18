import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDestination, reviewUrl } from '../lib/review-link';
import type { Board, BridgeEvent, Result } from '../lib/model';

test('Review export includes all recorded tables for this board and preserves selection', async () => {
  const board: Board = { number: 1, dealer: 'N', vulnerability: 'None', deal: { N: [], E: [], S: [], W: [] } };
  const result: Result = { assignmentId: 'open', board: 1, level: 4, strain: 'S', doubled: 1, declarer: 'N', tricks: 10, lead: 'HA', nsScore: 420, updatedAt: '' };
  const event: Pick<BridgeEvent, 'id' | 'assignments' | 'results' | 'kind' | 'participants' | 'gameMode'> = {
    id: 'stage-one', kind: 'teams', participants: [],
    assignments: [
      { id: 'open', round: 1, table: 1, room: 'open', ns: 't1', ew: 't2', boards: [1], matchId: 'm1', playerNames: { N: '北家' } },
      { id: 'closed', round: 2, table: 1, room: 'closed', ns: 't2', ew: 't1', boards: [1], matchId: 'm1' },
      { id: 'pending', round: 1, table: 2, room: 'open', ns: 't3', ew: 't4', boards: [1], matchId: 'm2' },
      { id: 'other', round: 3, table: 1, room: 'open', ns: 't1', ew: 't2', boards: [2], matchId: 'm3' },
    ],
    results: { 'open:1': result, 'closed:1': { ...result, assignmentId: 'closed', status: 'cancelled' }, 'other:2': { ...result, assignmentId: 'other', board: 2 } },
  };
  const url = new URL(await reviewUrl(board, new URL('https://review.example'), event, 'closed'));
  const bytes = Buffer.from(url.hash.slice(10), 'base64url');
  const data = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  assert.equal(data.results.length, 2);
  assert.equal(data.results[0].nsScore, 420);
  assert.equal(data.results[0].playerNames.N, '北家');
  assert.equal(data.results[0].table, '第 1 圈 · 第 1 桌 · 開室');
  assert.equal(data.results[1].table, '第 2 圈 · 第 1 桌 · 閉室');
  assert.equal(data.results[1].status, 'cancelled');
  assert.equal(data.selectedResultId, 'closed:1');
  event.results['open:1'] = { ...result, split: { ns: result, ew: { ...result, nsScore: 450 } } };
  const splitUrl = new URL(await reviewUrl(board, new URL('https://review.example'), event));
  const splitBytes = Buffer.from(splitUrl.hash.slice(10), 'base64url');
  const splitData = await new Response(new Blob([splitBytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  assert.equal(splitData.results.length, 2);
  assert.equal(splitData.results[0].split.ew.nsScore, 450);
  assert.equal(splitData.boards[0].originKey, data.boards[0].originKey);
  assert.equal(splitData.results[0].originKey, data.results[0].originKey);
  const otherUrl = new URL(await reviewUrl(board, new URL('https://review.example'), { ...event, id: 'another-stage' }));
  const other = await new Response(new Blob([Buffer.from(otherUrl.hash.slice(10), 'base64url')]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  assert.notEqual(other.boards[0].originKey, data.boards[0].originKey);
  assert.notEqual(other.results[0].originKey, data.results[0].originKey);
});

test('Review export preserves the single board using the version 1 gzip share protocol', async () => {
  const board: Board = { number: 17, dealer: 'W', vulnerability: 'All',
    deal: { N: [], E: [], S: [], W: [] } };
  for (const [i, seat] of (['N','E','S','W'] as const).entries())
    board.deal[seat] = [...'23456789TJQKA'].map(rank => 'SHDC'[i] + rank);
  const url = new URL(await reviewUrl(board, new URL('https://review.example/app/')));
  assert.equal(url.pathname, '/app/');
  assert.ok(url.hash.startsWith('#review=1.'));
  const bytes = Buffer.from(url.hash.slice(10), 'base64url');
  const decoded = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  const { originKey, ...exportedBoard } = decoded.boards[0];
  assert.match(originKey, /^[a-f0-9-]{36}$/);
  assert.deepEqual(exportedBoard, { id: 'board:17', ...board });
  assert.deepEqual(decoded.results, []);
  assert.equal(decoded.selectedBoardId, 'board:17');
});

test('Review destination uses local default only locally and validates configured URLs', () => {
  assert.equal(reviewDestination('', 'http://127.0.0.1:3000/').href, 'http://127.0.0.1:3001/');
  assert.equal(reviewDestination('https://review.example/app/', 'https://valet.example').href, 'https://review.example/app/');
  assert.throws(() => reviewDestination('', 'https://valet.example'));
  assert.throws(() => reviewDestination('javascript:alert(1)', 'https://valet.example'));
});
