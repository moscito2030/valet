import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { resultKey, type Result } from '../lib/model';
import { boardsForRole } from '../lib/public-event';

function played(assignmentId: string, board: number): Result {
  return {
    assignmentId,
    board,
    level: 1,
    strain: 'NT',
    doubled: 1,
    declarer: 'N',
    tricks: 7,
    lead: '',
    nsScore: 90,
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
}

test('staff see published deals only after every table has finished the board', () => {
  const event = createEvent({
    name: '賽務牌型',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-16',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  event.boards = event.boards.map((board) => ({ ...board, ...makeBoard(board.number), published: false }));
  assert.ok(boardsForRole(event, false).every((board) => !('deal' in board)));
  assert.ok('deal' in boardsForRole(event, true)[0]);
  event.boards[0].published = true;
  assert.equal('deal' in boardsForRole(event, false)[0], false);
  for (const assignment of event.assignments.filter((item) => item.boards.includes(1)))
    event.results[resultKey(assignment.id, 1)] = played(assignment.id, 1);
  assert.equal('deal' in boardsForRole(event, false)[0], true);
  assert.deepEqual(event.boards[0].deal, makeBoard(1).deal);
});
