import test from 'node:test';
import assert from 'node:assert/strict';
import { boardsStillInPlay } from '../lib/board-in-play';
import { readyBoardGroups } from '../lib/board-publication-ready';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { buildMovement } from '../lib/movement-plans';
import { resultKey, type BridgeEvent, type Result } from '../lib/model';
import { audienceEvent } from '../lib/read-models/public-event';

function howell(): BridgeEvent {
  const event = createEvent({
    name: 'Shared in-play rule',
    kind: 'pairs',
    pairMethod: 'mp',
    date: '2026-11-16',
    venue: 'Club',
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    rounds: 5,
    boardsPerRound: 3,
  });
  const plan = buildMovement(event, 'howell-3-5');
  event.assignments = plan.assignments;
  event.boards = Array.from({ length: plan.boardCount }, (_, i) => ({
    ...makeBoard(i + 1),
    published: false,
  }));
  return event;
}

function score(event: BridgeEvent, assignmentId: string, board: number): Result {
  const result: Result = {
    assignmentId,
    board,
    level: 4,
    strain: 'S',
    doubled: 1,
    declarer: 'N',
    tricks: 10,
    lead: 'HK',
    nsScore: 620,
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
  event.results[resultKey(assignmentId, board)] = result;
  return result;
}

function fill(event: BridgeEvent) {
  for (const assignment of event.assignments)
    for (const board of assignment.boards) score(event, assignment.id, board);
}

test('results, deals, and publication readiness follow the same in-play set', () => {
  const event = howell();
  const board = 1;
  const users = event.assignments.filter((a) => a.boards.includes(board));
  score(event, users[0].id, board);
  let waiting = boardsStillInPlay(event);
  assert.equal(waiting.has(board), true);
  let pub = audienceEvent(event);
  assert.equal(pub.results[resultKey(users[0].id, board)], undefined);
  assert.equal(pub.projection.pairScores[resultKey(users[0].id, board)], undefined);
  const hiddenDeal = pub.boards.find((b) => b.number === board)!;
  assert.equal(hiddenDeal.published, false);
  assert.equal('deal' in hiddenDeal, false);
  assert.ok(readyBoardGroups(event).every((group) => group.every((b) => !waiting.has(b.number))));

  fill(event);
  waiting = boardsStillInPlay(event);
  assert.equal(waiting.size, 0);
  const ready = readyBoardGroups(event);
  assert.ok(ready.some((group) => group.some((b) => b.number === board)));
  assert.ok(ready.every((group) => group.every((b) => !waiting.has(b.number))));
  for (const item of event.boards) item.published = true;
  pub = audienceEvent(event);
  assert.equal(pub.results[resultKey(users[0].id, board)].lead, 'HK');
  assert.equal(pub.boards.find((b) => b.number === board)!.published, true);
  assert.equal('deal' in pub.boards.find((b) => b.number === board)!, true);
});

test('a published flag does not reveal a deal or a result while the shared predicate says the board is in play', () => {
  const event = howell();
  for (const board of event.boards) board.published = true;
  const replayed = event.assignments.find((a) => a.round === 1)!.boards[0];
  const table = event.assignments.find((a) => a.round === 1 && a.boards.includes(replayed))!;
  score(event, table.id, replayed);
  event.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [1] };
  const waiting = boardsStillInPlay(event);
  assert.equal(waiting.has(replayed), true);
  const pub = audienceEvent(event);
  assert.equal(pub.results[resultKey(table.id, replayed)], undefined);
  assert.equal('deal' in pub.boards.find((b) => b.number === replayed)!, false);
  assert.ok(readyBoardGroups(event).every((group) => group.every((b) => !waiting.has(b.number))));
});
