import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/domain/event-factory';
import { makeBoard } from '../lib/domain/board-factory';
import { buildMovement } from '../lib/movement-plans';
import { resultKey, type BridgeEvent, type Result } from '../lib/model';
import { audienceEvent } from '../lib/read-models/public-event';
import { project } from '../lib/scoring';

function howell(): BridgeEvent {
  const event = createEvent({
    name: 'Howell replay',
    kind: 'pairs',
    pairMethod: 'crossimp',
    trim: 'none',
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
    published: true,
  }));
  return event;
}

function score(event: BridgeEvent, assignmentId: string, board: number, lead = ''): Result {
  const result: Result = {
    assignmentId,
    board,
    level: 4,
    strain: 'S',
    doubled: 1,
    declarer: 'N',
    tricks: 10,
    lead,
    nsScore: 620,
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
  event.results[resultKey(assignmentId, board)] = result;
  return result;
}

function roundsPlaying(event: BridgeEvent, board: number) {
  return [...new Set(event.assignments.filter((a) => a.boards.includes(board)).map((a) => a.round))].sort(
    (a, b) => a - b,
  );
}

test('settled Howell results stay hidden while a later round still plays that board', () => {
  const event = howell();
  const board = 1;
  const rounds = roundsPlaying(event, board);
  assert.ok(rounds.length > 1, 'board 1 is replayed across rounds');
  assert.equal(rounds[0], 1);
  const early = event.assignments.find((a) => a.round === 1 && a.boards.includes(board))!;
  score(event, early.id, board, 'HK');
  event.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [1] };
  const stored = project(event);
  assert.ok(stored.standings.some((row) => row.played > 0));
  const pub = audienceEvent(event, stored);
  assert.equal(pub.results[resultKey(early.id, board)], undefined);
  assert.equal(JSON.stringify(pub.results).includes('"lead":"HK"'), false);
  assert.equal(JSON.stringify(pub.projection).includes('"lead":"HK"'), false);
  assert.ok(pub.projection.standings.every((row) => row.played === 0));
  assert.equal(pub.projection.pairScores[resultKey(early.id, board)], undefined);
  const shown = pub.boards.find((b) => b.number === board)!;
  assert.equal(shown.published, false);
  assert.equal('deal' in shown, false);

  event.club.finalized = rounds.slice(0, -1);
  const stillHidden = audienceEvent(event, project(event));
  assert.equal(stillHidden.results[resultKey(early.id, board)], undefined);
  assert.ok(stillHidden.projection.standings.every((row) => row.played === 0));

  event.club.finalized = rounds;
  const released = audienceEvent(event, project(event));
  assert.equal(released.results[resultKey(early.id, board)].lead, 'HK');
  assert.equal(released.results[resultKey(early.id, board)].tricks, 10);
  assert.equal(released.results[resultKey(early.id, board)].level, 4);
  assert.ok(released.projection.standings.some((row) => row.played > 0));
});

test('director scoring hides a board until every scheduled table has a result', () => {
  const event = howell();
  const replayed = 1;
  const users = event.assignments.filter((a) => a.boards.includes(replayed));
  assert.ok(users.length > 1);
  score(event, users[0].id, replayed, 'HK');
  const stored = project(event);
  const hidden = audienceEvent(event, stored);
  assert.equal(hidden.results[resultKey(users[0].id, replayed)], undefined);
  assert.equal(JSON.stringify(hidden).includes('"lead":"HK"'), false);
  assert.ok(hidden.projection.standings.every((row) => row.played === 0));
  assert.notDeepEqual(hidden.projection.standings, stored.standings);

  for (const assignment of users.slice(0, -1)) score(event, assignment.id, replayed, 'HK');
  const almost = audienceEvent(event, project(event));
  assert.equal(Object.values(almost.results).some((r) => r.board === replayed), false);

  for (const assignment of users) score(event, assignment.id, replayed, 'HK');
  const lone = event.assignments.find((a) => !a.boards.includes(replayed))!;
  score(event, lone.id, lone.boards[0], 'DA');
  const partial = audienceEvent(event, project(event));
  assert.ok(Object.values(partial.results).some((r) => r.board === replayed && r.lead === 'HK'));
  assert.equal(partial.results[resultKey(lone.id, lone.boards[0])], undefined);
  assert.equal(JSON.stringify(partial.results).includes('"lead":"DA"'), false);
  assert.equal(partial.projection.pairScores[resultKey(lone.id, lone.boards[0])], undefined);
  assert.ok(partial.projection.standings.some((row) => row.played > 0));

  for (const assignment of event.assignments.filter((a) => a.boards.includes(lone.boards[0])))
    score(event, assignment.id, lone.boards[0], 'DA');
  const both = audienceEvent(event);
  assert.equal(both.results[resultKey(lone.id, lone.boards[0])].lead, 'DA');
});

test('a board played only in a settled round is published while a replayed board stays private', () => {
  const event = howell();
  const replayed = event.assignments.find((a) => a.round === 1)!.boards[0];
  const laterOnly = event.assignments
    .filter((a) => a.round === event.rounds)
    .flatMap((a) => a.boards)
    .find((board) => roundsPlaying(event, board).every((round) => round === event.rounds))!;
  const early = event.assignments.find((a) => a.boards.includes(replayed) && a.round === 1)!;
  const last = event.assignments.find((a) => a.boards.includes(laterOnly))!;
  score(event, early.id, replayed, 'HK');
  score(event, last.id, laterOnly, 'SQ');
  event.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [event.rounds] };
  const pub = audienceEvent(event, project(event));
  assert.equal(pub.results[resultKey(early.id, replayed)], undefined);
  assert.equal(pub.results[resultKey(last.id, laterOnly)].lead, 'SQ');
  assert.equal(JSON.stringify(pub).includes('"lead":"HK"'), false);
});
