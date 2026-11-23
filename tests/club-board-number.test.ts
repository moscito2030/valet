import assert from 'node:assert/strict';
import test from 'node:test';
import { displayedBoardNumber } from '../lib/board-navigation';
import { clubView } from '../lib/club-view';
import { emptyScoreForm, parsedResult } from '../lib/contract-choice';
import { createEvent, makeBoard } from '../lib/events';

const boards = [31, 32, 33, 34, 35, 36];

function tabletView(kind: 'teams' | 'pairs', maxBoardNumber?: number) {
  const event = createEvent({
    name: 'Tablet board numbering',
    kind,
    date: '2026-10-14',
    venue: '',
    names: ['Team A', 'Team B', 'Team C', 'Team D'],
    rounds: 1,
    boardsPerRound: boards.length,
  });
  const assignment = event.assignments[0];
  event.currentRound = assignment.round;
  event.maxBoardNumber = maxBoardNumber;
  event.boards = boards.map(number => makeBoard(number));
  assignment.boards = [...boards];
  return clubView(event, assignment.ns);
}

test('tablet view provides the explicit cap and keeps full board numbers for score entry', () => {
  const view = tabletView('teams', 30);
  assert.equal(view.kind, 'teams');
  assert.equal(view.maxBoardNumber, 30);
  assert.deepEqual(view.boards.map(board => board.number), boards);
  assert.deepEqual(view.boards.map(board => displayedBoardNumber(board.number, view)), [1, 2, 3, 4, 5, 6]);

  const draft = emptyScoreForm(view.assignment!.id, view.boards[0].number);
  draft.choice.level = 0;
  assert.equal(parsedResult(draft)?.board, 31);
});

test('tablet view uses the public board-number defaults for teams and pairs', () => {
  const teams = tabletView('teams');
  const pairs = tabletView('pairs');
  assert.equal(teams.maxBoardNumber, undefined);
  assert.equal(pairs.maxBoardNumber, undefined);
  assert.equal(pairs.kind, 'pairs');
  assert.deepEqual(teams.boards.map(board => displayedBoardNumber(board.number, teams)), [31, 32, 1, 2, 3, 4]);
  assert.deepEqual(pairs.boards.map(board => displayedBoardNumber(board.number, pairs)), boards);
});
