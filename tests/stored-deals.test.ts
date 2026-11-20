import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { audienceEvent } from '../lib/club-view';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { resultKey, type Board, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { hydrateEvent } from '../lib/storage/hydrate-event';
import { createLocalRepository } from '../lib/storage/local';

function dealFingerprint(boards: Board[]) {
  return boards.map((board) => ({
    number: board.number,
    dealer: board.dealer,
    vulnerability: board.vulnerability,
    published: board.published ?? null,
    group: board.group ?? null,
    deal: board.deal,
  }));
}

test('reading an existing stored section does not change applied deals', async () => {
  const event = createEvent({
    name: '已發牌賽段',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    date: '2026-11-17',
    venue: '社內',
    rounds: 5,
    boardsPerRound: 3,
  });
  event.id = '58f461bf-e3df-4dab-b5ac-88ba69025f2d';
  event.boards = Array.from({ length: 15 }, (_, index) => {
    const board = makeBoard(index + 1);
    const north = board.deal.N;
    board.deal = { ...board.deal, N: [north[12], ...north.slice(0, 12)] };
    board.published = index < 3;
    board.group = `set-${Math.floor(index / 3) + 1}`;
    return board;
  });
  const table = event.assignments[0];
  event.results[resultKey(table.id, 1)] = {
    assignmentId: table.id,
    board: 1,
    level: 4,
    strain: 'S',
    doubled: 1,
    declarer: 'N',
    tricks: 10,
    lead: 'HK',
    nsScore: 620,
    updatedAt: event.updatedAt,
  };
  const stored: StoredEvent = { event, requests: [], projection: project(event) };
  const fingerprint = dealFingerprint(event.boards);
  const directory = await mkdtemp(path.join(tmpdir(), 'valet-deals-'));
  const file = path.join(directory, 'events.json');
  await writeFile(file, JSON.stringify([stored]));
  const before = await readFile(file, 'utf8');
  try {
    const loaded = await createLocalRepository(directory).getEvent(event.id);
    const viewed = audienceEvent(loaded.event, loaded.projection);
    const hydrated = hydrateEvent(JSON.parse(before)[0], {
      id: event.id,
      name: event.name,
      venue: event.venue,
      hasStages: false,
      revision: event.revision,
    });
    assert.equal(await readFile(file, 'utf8'), before);
    assert.equal(loaded.event.boards.length, 15);
    assert.deepEqual(dealFingerprint(hydrated.event.boards), fingerprint);
    assert.deepEqual(dealFingerprint(loaded.event.boards), fingerprint);
    assert.deepEqual(
      dealFingerprint(JSON.parse(before)[0].event.boards),
      fingerprint,
    );
    assert.equal(viewed.boards.length, 15);
    assert.deepEqual(
      viewed.boards.map((board) => board.number),
      fingerprint.map((board) => board.number),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
