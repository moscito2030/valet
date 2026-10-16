import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewDestination, reviewUrl } from '../lib/review-link';
import type { Board } from '../lib/model';

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
  assert.deepEqual(decoded.boards[0], { id: 'board:17', ...board });
  assert.deepEqual(decoded.results, []);
  assert.equal(decoded.selectedBoardId, 'board:17');
});

test('Review destination uses local default only locally and validates configured URLs', () => {
  assert.equal(reviewDestination('', 'http://127.0.0.1:3000/').href, 'http://127.0.0.1:3001/');
  assert.equal(reviewDestination('https://review.example/app/', 'https://valet.example').href, 'https://review.example/app/');
  assert.throws(() => reviewDestination('', 'https://valet.example'));
  assert.throws(() => reviewDestination('javascript:alert(1)', 'https://valet.example'));
});
