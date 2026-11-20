import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { effectiveBoardPublished, materializeBoardPublication } from '../lib/board-publication';
import { audienceEvent } from '../lib/read-models/public-event';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { discussionPublished } from '../lib/discussion';
import { seats, type Board, type BridgeEvent, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { publicBoards } from '../lib/public-event';
import { createNeonRepository } from '../lib/storage/neon';
import { seedResultWrites } from '../lib/storage/cell-write';
import { materializePublication } from '../lib/storage/materialize-publication';
import { saveStage } from '../lib/storage/rows';
import { createTestDb } from './helpers/sql';

function dealt(boards: Board[]) {
  return boards.map((board) => seats.map((seat) => board.deal[seat].join('')).join('|'));
}

function dealFingerprint(boards: Board[]) {
  return boards.map((board) => ({
    number: board.number,
    dealer: board.dealer,
    vulnerability: board.vulnerability,
    deal: board.deal,
  }));
}

function publicShape(event: BridgeEvent) {
  return audienceEvent(event, project(event)).boards.map((board) => ({
    number: board.number,
    published: board.published,
    deal: 'deal' in board ? board.deal : null,
  }));
}

function legacyView(event: BridgeEvent & { publishBoards?: boolean }) {
  const explicit = structuredClone(event);
  delete explicit.publishBoards;
  explicit.boards = explicit.boards.map((board) => ({
    ...board,
    published: effectiveBoardPublished(event, board),
  }));
  return {
    flags: explicit.boards.map((board) => board.published),
    deals: dealFingerprint(event.boards),
    public: publicShape(explicit),
    discussion: event.boards.map((board) => discussionPublished(explicit, board.number)),
  };
}

test('materializing publishBoards keeps public visibility and deals, including the synthetic 11月社內賽 fixture', () => {
  const club = createEvent({
    name: '11月社內賽',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    date: '2026-11-17',
    venue: '社內',
    rounds: 5,
    boardsPerRound: 3,
  });
  club.id = '58f461bf-e3df-4dab-b5ac-88ba69025f2d';
  club.boards = Array.from({ length: 15 }, (_, index) => {
    const board = makeBoard(index + 1);
    const north = board.deal.N;
    board.deal = { ...board.deal, N: [north[12], ...north.slice(0, 12)] };
    if (index < 3) board.published = true;
    else if (index < 6) board.published = false;
    board.group = `set-${Math.floor(index / 3) + 1}`;
    return board;
  });
  const withFlag = { ...club, publishBoards: true as const };
  const omitted = createEvent({
    name: '舊公開旗標',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-17',
    venue: 'Hall',
    rounds: 1,
    boardsPerRound: 2,
  });
  const hidden = { ...omitted, publishBoards: false as const };
  const shown = structuredClone(omitted);
  shown.boards = shown.boards.map((board) => {
    const copy = { ...board };
    delete copy.published;
    return copy;
  });
  const shownLegacy = { ...shown, publishBoards: true as const };

  for (const event of [withFlag, hidden, shownLegacy]) {
    const before = legacyView(event);
    const migrated = materializeBoardPublication(event);
    assert.equal('publishBoards' in migrated, false);
    assert.deepEqual(
      migrated.boards.map((board) => board.published),
      before.flags,
    );
    assert.deepEqual(dealFingerprint(migrated.boards), before.deals);
    assert.deepEqual(publicShape(migrated), before.public);
    assert.deepEqual(
      migrated.boards.map((board) => discussionPublished(migrated, board.number)),
      before.discussion,
    );
    assert.deepEqual(materializeBoardPublication(migrated), migrated);
  }
  assert.equal(dealFingerprint(withFlag.boards)[0].deal.N[0], club.boards[0].deal.N[0]);
  assert.notEqual(withFlag.boards[0].deal.N[0], makeBoard(1).deal.N[0]);
});

test('the publication file script verifies, writes once, and is idempotent', async () => {
  const event = createEvent({
    name: '11月社內賽',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    date: '2026-11-17',
    venue: '社內',
    rounds: 5,
    boardsPerRound: 3,
  });
  event.id = '58f461bf-e3df-4dab-b5ac-88ba69025f2d';
  event.boards = event.boards.map((board, index) => ({
    ...board,
    ...(index === 0 ? { published: false } : {}),
  }));
  const stored: StoredEvent & { event: BridgeEvent & { publishBoards?: boolean } } = {
    event: { ...event, publishBoards: true },
    requests: [],
    projection: project(event),
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'valet-publish-'));
  const file = path.join(directory, 'events.json');
  await writeFile(file, JSON.stringify([stored]));
  const deals = JSON.stringify(stored.event.boards.map((board) => board.deal));
  try {
    const run = () =>
      spawnSync('npx', ['tsx', 'scripts/materialize-board-publication.ts', file], {
        cwd: process.cwd(),
        env: { ...process.env, MATERIALIZE_PUBLISH_BOARDS: '1' },
        encoding: 'utf8',
      });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const written = JSON.parse(await readFile(file, 'utf8')) as StoredEvent[];
    assert.equal('publishBoards' in written[0].event, false);
    assert.equal(written[0].event.boards[0].published, false);
    assert.equal(written[0].event.boards[1].published, true);
    assert.equal(JSON.stringify(written[0].event.boards.map((board) => board.deal)), deals);
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(await readFile(file, 'utf8'), JSON.stringify(written));
    const refused = spawnSync('npx', ['tsx', 'scripts/materialize-board-publication.ts', file], {
      cwd: process.cwd(),
      env: { ...process.env, MATERIALIZE_PUBLISH_BOARDS: '' },
      encoding: 'utf8',
    });
    assert.notEqual(refused.status, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('normalized board rows materialize publication without changing deals', async () => {
  const event = createEvent({
    name: '公開遷移',
    kind: 'pairs',
    date: '2026-11-20',
    venue: '測試',
    names: ['甲', '乙', '丙', '丁'],
    rounds: 1,
    boardsPerRound: 2,
  });
  event.boards = event.boards.map((board, index) => {
    const made = makeBoard(board.number);
    if (index === 0) {
      const north = made.deal.N;
      made.deal = { ...made.deal, N: [north[12], ...north.slice(0, 12)] };
    }
    return { ...board, ...made, ...(index === 0 ? { published: false } : {}) };
  });
  const flagged = { ...event, publishBoards: true as const };
  const deals = flagged.boards.map((board) => JSON.stringify(board.deal));

  const normalizedDb = await createTestDb();
  try {
    const stored: StoredEvent = {
      event: flagged as BridgeEvent,
      projection: project(flagged),
      requests: [],
    };
    await saveStage(normalizedDb.sql, stored, seedResultWrites(flagged));
    await normalizedDb.sql`INSERT INTO bridge_events (id, revision, document, updated_at)
      VALUES (${event.id}, ${event.revision}, ${JSON.stringify(stored)}::jsonb, '1970-01-01T00:00:00.000Z')`;
    const repo = createNeonRepository(normalizedDb.sql);
    const read = await repo.getEvent(event.id);
    assert.equal(read.event.boards[1].published, true);
    assert.deepEqual(read.event.boards.map((board) => JSON.stringify(board.deal)), deals);
    const beforeRows = await normalizedDb.sql`SELECT board_number, document_json FROM bridge_boards WHERE event_id = ${event.id} ORDER BY board_number`;
    const hiddenJson = String(beforeRows[0].document_json);
    assert.equal(hiddenJson.includes('"published":false'), true);
    assert.equal(String(beforeRows[1].document_json).includes('"published"'), false);
    const dry = await materializePublication(normalizedDb.sql, { dryRun: true });
    assert.deepEqual(dry, { mode: 'dry-run', stages: 1, boards: 1 });
    assert.deepEqual(
      await normalizedDb.sql`SELECT board_number, document_json FROM bridge_boards WHERE event_id = ${event.id} ORDER BY board_number`,
      beforeRows,
    );
    const drySettings = await normalizedDb.sql`SELECT settings FROM bridge_stages WHERE id = ${event.id}`;
    assert.equal((drySettings[0].settings as { publishBoards?: boolean }).publishBoards, true);
    const report = await materializePublication(normalizedDb.sql, { dryRun: false });
    assert.equal(report.stages, 1);
    assert.equal(report.boards, 1);
    const afterRows = await normalizedDb.sql`SELECT board_number, document_json FROM bridge_boards WHERE event_id = ${event.id} ORDER BY board_number`;
    assert.equal(String(afterRows[0].document_json), hiddenJson);
    const shown = JSON.parse(String(afterRows[1].document_json)) as Board;
    assert.equal(shown.published, true);
    assert.equal(JSON.stringify(shown.deal), deals[1]);
    const settings = await normalizedDb.sql`SELECT settings FROM bridge_stages WHERE id = ${event.id}`;
    assert.equal('publishBoards' in (settings[0].settings as object), false);
    const legacy = await normalizedDb.sql`SELECT document, updated_at::text AS updated_at FROM bridge_events WHERE id = ${event.id}`;
    const legacyEvent = (legacy[0].document as StoredEvent).event as BridgeEvent & { publishBoards?: boolean };
    assert.equal(legacyEvent.publishBoards, true);
    assert.equal(String(legacy[0].updated_at).startsWith('1970-01-01'), true);
    const again = await materializePublication(normalizedDb.sql, { dryRun: false });
    assert.equal(again.stages, 0);
    assert.equal(again.boards, 0);
  } finally {
    await normalizedDb.close();
  }
});
