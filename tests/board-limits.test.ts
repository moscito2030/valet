import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, resultKey } from '../lib/model';
import { movementOptions, buildMovement, movementBoardError } from '../lib/movement-plans';
import { generateDealerBoards } from '../lib/dealer-source';
import { exportMovement, parseMovement, exportPbn, parsePbn, exportResultsCsv, parseResultsCsv } from '../lib/imports';
import { project } from '../lib/scoring';

const input = { name: 'Large board set', kind: 'teams' as const, names: ['A','B','C','D','E'], rounds: 8, boardsPerRound: 16, date: '2026-10-17', venue: '' };

test('movement options are independent of board count; only per-round validation limits application', () => {
  for (const kind of ['teams', 'pairs'] as const) {
    const event = createEvent({ ...input, kind, rounds: 4, names: ['A','B','C','D','E','F'] });
    for (const boardsPerRound of [0, 1, 8, 16, 17, 100, NaN]) {
      assert.deepEqual(movementOptions({ ...event, boardsPerRound }), movementOptions(event));
      if (boardsPerRound >= 1 && boardsPerRound <= 16) assert.equal(movementBoardError(boardsPerRound), null);
      else assert.match(movementBoardError(boardsPerRound)!, /1–16/);
    }
  }
  assert.throws(() => createEvent({ ...input, boardsPerRound: 17 }));
  const event = createEvent(input);
  assert.throws(() => applyMutation({ event, projection: project(event), requests: [] }, mutationSchema.parse({ action: 'movement-plan', plan: 'team-interleaved-5', revision: event.revision, requestId: randomUUID(), reason: 'test', boardsPerRound: 17 })));
  assert.equal(buildMovement({ ...event, rounds: 28 }, 'team-interleaved-5').boardCount, 560);
  assert.equal(createEvent({ ...input, rounds: 31 }).boards.length, 496);
});

test('160-board interleaved event supports deals, scoring, CSV, publication and rulings beyond board 128', async () => {
  const event = createEvent(input);
  let stored = { event, projection: project(event), requests: [] as string[] };
  const apply = (payload: object) => {
    stored = applyMutation(stored, mutationSchema.parse({ revision: stored.event.revision, requestId: randomUUID(), reason: 'Large board verification', ...payload }));
    return stored.event;
  };
  apply({ action: 'movement-plan', plan: 'team-interleaved-5' });
  assert.equal(stored.event.boards.length, 160);
  assert.deepEqual(parseMovement(exportMovement(stored.event), stored.event), stored.event.assignments);
  const generated = await generateDealerBoards(stored.event.boards, '');
  const pbn = exportPbn({ boards: generated });
  assert.equal(parsePbn(pbn).length, 160);
  apply({ action: 'pbn', pbn });
  assert.equal(stored.event.boards[159].deal.N.length, 13);
  apply({ action: 'board-publication', board: 160, published: true });
  assert.equal(stored.event.boards[159].published, true);
  const table = stored.event.assignments.find(a => a.boards.includes(160))!;
  const result = { assignmentId: table.id, board: 160, level: 4, strain: 'H', doubled: 1, declarer: 'N', tricks: 10, lead: '' };
  apply({ action: 'results', results: [result] });
  assert.equal(parseResultsCsv(exportResultsCsv(stored.event))[0].board, 160);
  apply({ action: 'results-import', csv: exportResultsCsv(stored.event) });
  apply({ action: 'split-contract', assignmentId: table.id, board: 160, contracts: { ns: result, ew: { ...result, tricks: 9 } } });
  assert.ok(stored.event.results[resultKey(table.id,160)].split);
  apply({ action: 'split-contract', assignmentId: table.id, board: 160, contracts: null });
  apply({ action: 'ruling', assignmentId: table.id, board: 160, cancelled: true });
  assert.equal(stored.event.results[resultKey(table.id,160)].status, 'cancelled');
  apply({ action: 'ruling', assignmentId: table.id, board: 160, cancelled: false, result });
  assert.equal(stored.event.results[resultKey(table.id,160)].status, 'played');
  apply({ action: 'settings', status: 'live', maxBoardNumber: 160 });
  assert.equal(stored.event.maxBoardNumber, 160);
  assert.throws(() => apply({ action: 'results', results: [{ ...result, board: 161 }] }), /牌號|賽程/);
  assert.throws(() => apply({ action: 'board-publication', board: 161, published: true }), /牌號/);
});
