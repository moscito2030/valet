import test from 'node:test';
import assert from 'node:assert/strict';
import { seedEvents } from '../lib/events';
import { audienceEvent } from '../lib/club-view';
import { privateBoardPreview } from '../lib/private-board-preview';

test('private board preview includes unpublished scores without changing audience data', () => {
  for (const { event } of seedEvents()) {
    event.publishBoards = false;
    event.boards.forEach(b => b.published = false);
    event.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [] };
    const before = structuredClone(event);
    const publicBefore = audienceEvent(event);
    const board = event.boards[0];
    const preview = privateBoardPreview(event, board);
    assert.ok(Object.keys(preview.results).length > 0);
    assert.ok(Object.values(preview.results).every(r => r.board === board.number));
    assert.ok(Object.keys(preview.pairScores).every(key => key in preview.results));
    assert.equal(preview.board.deal.N.length, 13);
    assert.deepEqual(publicBefore.results, {});
    assert.ok(publicBefore.boards.every(b => !('deal' in b)));
    assert.deepEqual(event, before);
    assert.deepEqual(audienceEvent(event), publicBefore);
    assert.doesNotThrow(() => privateBoardPreview(event, { ...board, deal: { N: [], S: [], E: [], W: [] } }));
  }
});
