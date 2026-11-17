import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCompetition, competitionKey, isStage, type StoredCompetition } from '../lib/competition-record';
import { DomainError } from '../lib/domain-error';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { buildMovement, movementOptions } from '../lib/movement-plans';
import { mutationSchema, resultKey, type BridgeEvent, type StoredEvent } from '../lib/model';
import { applyMutation } from '../lib/mutations/apply';
import { project } from '../lib/scoring';
import { competitionCatalog } from '../lib/competitions';
import { eventIndex } from '../lib/event-index';
import { canonical, seedResultWrites } from '../lib/storage/cell-write';
import { createLocalRepository } from '../lib/storage/local';
import {
  formatMigrationReport,
  migrateLegacyDocuments,
  readLegacyDocuments,
} from '../lib/storage/migrate-data';
import { assertMergePreserved, commitStageMerge, mergeReport, planStageMerge, stageMerge } from '../lib/storage/merge-stages';
import { createNeonRepository } from '../lib/storage/neon';
import { createNormalizedRepository } from '../lib/storage/normalized';
import { loadStage, saveStage } from '../lib/storage/rows';
import { restoreLegacy } from '../lib/storage/restore-legacy';
import { verifyStage } from '../lib/storage/verify-stage';
import { createTestDb } from './helpers/sql';

const conflict = (error: unknown) => error instanceof DomainError && error.status === 409;
const score = (assignmentId: string, board: number, tricks: number, revision: number) =>
  mutationSchema.parse({
    action: 'results',
    reason: '契約驗證',
    revision,
    requestId: randomUUID(),
    results: [
      {
        assignmentId,
        board,
        level: 2,
        strain: 'H',
        declarer: 'N',
        doubled: 1,
        tricks,
        lead: '',
      },
    ],
  });

function withDeals(event: BridgeEvent) {
  event.boards = event.boards.map((board) => ({ ...makeBoard(board.number), published: board.published }));
  return event;
}

function stored(event: BridgeEvent, requests: string[] = []): StoredEvent {
  return { event, requests, projection: project(event) };
}

async function normalizedRepo() {
  const db = await createTestDb();
  await db.sql`UPDATE bridge_storage_switch SET mode = 'normalized', legacy_watermark = '1970-01-01T00:00:00.000Z' WHERE id = 1`;
  return { ...db, repo: createNormalizedRepository(db.sql) };
}

test('request ids stay durable past 500', async () => {
  let event = createEvent({
    name: '冪等',
    kind: 'teams',
    date: '2026-10-18',
    venue: '廳',
    names: ['甲', '乙', '丙', '丁'],
    rounds: 1,
    boardsPerRound: 1,
  });
  let current = stored(event);
  const ids: string[] = [];
  for (let index = 0; index < 501; index++) {
    const requestId = randomUUID();
    ids.push(requestId);
    current = applyMutation(
      current,
      mutationSchema.parse({
        action: 'penalty',
        participantId: event.participants[0].id,
        amount: index % 3,
        reason: '契約驗證',
        revision: current.event.revision,
        requestId,
      }),
      true,
    );
  }
  assert.equal(current.requests.length, 501);
  const replayed = applyMutation(
    current,
    mutationSchema.parse({
      action: 'penalty',
      participantId: event.participants[0].id,
      amount: 9,
      reason: '契約驗證',
      revision: current.event.revision,
      requestId: ids[0],
    }),
    true,
  );
  assert.equal(replayed.event.revision, current.event.revision);
  const db = await normalizedRepo();
  try {
    await saveStage(db.sql, current, seedResultWrites(current.event));
    const loaded = await loadStage(db.sql, current.event.id);
    assert.equal(loaded?.stored.requests.length, 501);
    const again = await db.repo.mutateEvent(current.event.id, mutationSchema.parse({
      action: 'penalty',
      participantId: event.participants[0].id,
      amount: 4,
      reason: '契約驗證',
      revision: current.event.revision,
      requestId: ids[0],
    }));
    assert.equal(again.event.audit.length, current.event.audit.length);
  } finally {
    await db.close();
  }
});

for (const kind of ['local', 'normalized'] as const)
  test(`${kind} writers on different tables both commit and the same table conflicts`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'valet-cells-'));
    const db = kind === 'normalized' ? await normalizedRepo() : null;
    const repo =
      db?.repo ??
      createLocalRepository(directory);
    try {
      const event = withDeals(
        createEvent({
          name: '分桌',
          kind: 'pairs',
          movementPlan: 'double-barometer',
          names: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
          date: '2026-10-20',
          venue: '廳',
          rounds: 2,
          boardsPerRound: 2,
        }),
      );
      await repo.insertEvent(event);
      const tables = event.assignments.filter((assignment) => assignment.round === 1);
      assert.ok(tables.length >= 2);
      const board = tables[0].boards[0];
      assert.ok(tables[1].boards.includes(board));
      const different = await Promise.allSettled([
        repo.mutateEvent(event.id, score(tables[0].id, board, 8, 1)),
        repo.mutateEvent(event.id, score(tables[1].id, board, 9, 1)),
      ]);
      assert.equal(different.filter((result) => result.status === 'fulfilled').length, 2);
      const saved = await repo.getEvent(event.id);
      assert.equal(saved.event.results[resultKey(tables[0].id, board)].tricks, 8);
      assert.equal(saved.event.results[resultKey(tables[1].id, board)].tricks, 9);
      const ranked = (rows: { id: string }[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(ranked(saved.projection.standings), ranked(project(saved.event).standings));
      const same = await Promise.allSettled([
        repo.mutateEvent(event.id, score(tables[0].id, board, 10, saved.event.revision)),
        repo.mutateEvent(event.id, score(tables[0].id, board, 11, saved.event.revision)),
      ]);
      assert.equal(same.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(same.filter((result) => result.status === 'rejected' && conflict(result.reason)).length, 1);
      const final = await repo.getEvent(event.id);
      assert.deepEqual(ranked(final.projection.standings), ranked(project(final.event).standings));
      if (db) {
        const rows = await db.sql`SELECT assignment_id, board, revision FROM bridge_results WHERE event_id = ${event.id} ORDER BY assignment_id`;
        const winner = rows.find((row) => row.assignment_id === tables[0].id && Number(row.board) === board);
        const other = rows.find((row) => row.assignment_id === tables[1].id && Number(row.board) === board);
        assert.equal(Number(winner?.revision), 2);
        assert.equal(Number(other?.revision), 1);
      }
    } finally {
      await db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

test('migration round-trips mitchell, howell, teams, knockout, stages and aborts on a changed deal', async () => {
  const mitchell = withDeals(
    createEvent({
      name: 'Mitchell',
      kind: 'pairs',
      movementPlan: 'double-mitchell',
      names: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      date: '2026-10-20',
      venue: '一廳',
      rounds: 2,
      boardsPerRound: 2,
    }),
  );
  const howell = createEvent({
    name: 'Howell',
    kind: 'pairs',
    names: Array.from({ length: 8 }, (_, index) => `H${index}`),
    date: '2026-10-21',
    venue: '二廳',
    rounds: 7,
    boardsPerRound: 1,
  });
  const howellPlan = movementOptions(howell).find((option) => option.id.includes('howell'));
  assert.ok(howellPlan, 'expected a Howell movement for 4 tables and 7 rounds');
  const built = buildMovement(howell, howellPlan.id);
  howell.assignments = built.assignments;
  howell.boards = Array.from({ length: built.boardCount }, (_, index) => makeBoard(index + 1));
  const teams = withDeals(
    createEvent({
      name: 'Teams',
      kind: 'teams',
      date: '2026-10-22',
      venue: '三廳',
      names: ['甲', '乙', '丙', '丁'],
      rounds: 1,
      boardsPerRound: 2,
    }),
  );
  let teamsStored = stored(teams);
  teamsStored = applyMutation(
    teamsStored,
    score(teams.assignments[0].id, teams.assignments[0].boards[0], 9, teamsStored.event.revision),
  );
  teamsStored = applyMutation(
    teamsStored,
    mutationSchema.parse({
      action: 'penalty',
      participantId: teams.participants[0].id,
      amount: 3,
      reason: '契約驗證',
      revision: teamsStored.event.revision,
      requestId: randomUUID(),
    }),
  );
  const knockout = withDeals(
    createEvent({
      name: 'KO',
      kind: 'teams',
      teamFormat: 'knockout',
      names: ['東', '南', '西', '北'],
      date: '2026-10-23',
      venue: '四廳',
      rounds: 1,
      boardsPerRound: 2,
    }),
  );
  let knockoutStored = stored(knockout);
  knockoutStored = applyMutation(
    knockoutStored,
    mutationSchema.parse({
      action: 'knockout-publish',
      reason: '契約驗證',
      revision: knockoutStored.event.revision,
      requestId: randomUUID(),
    }),
  );
  const rehearsal = withDeals(
    createEvent({
      name: '預演',
      kind: 'pairs',
      names: ['甲', '乙', '丙', '丁'],
      date: '2026-10-20',
      venue: '社辦',
      rounds: 1,
      boardsPerRound: 1,
    }),
  );
  rehearsal.stageArchived = true;
  rehearsal.parentEventId = 'root-stage';
  rehearsal.stageName = '預演';
  const final = withDeals(
    createEvent({
      name: '正賽',
      kind: 'pairs',
      names: ['甲', '乙', '丙', '丁'],
      date: '2026-10-20',
      venue: '社辦',
      rounds: 1,
      boardsPerRound: 2,
    }),
  );
  final.parentEventId = 'root-stage';
  final.stageName = '正賽';
  const fifteen = withDeals(
    createEvent({
      name: '十五副',
      kind: 'pairs',
      names: ['甲', '乙', '丙', '丁'],
      date: '2026-11-17',
      venue: '社辦',
      rounds: 5,
      boardsPerRound: 3,
    }),
  );
  assert.equal(fifteen.boards.length, 15);
  const db = await createTestDb();
  try {
    const documents = [
      stored(mitchell),
      stored(howell),
      teamsStored,
      knockoutStored,
      stored(rehearsal),
      stored(final),
      stored(fifteen),
      createCompetition({ name: '分階段', prefix: '舊', venue: '社辦' }, 'root-stage'),
    ];
    for (const document of documents) {
      const id = 'event' in document ? document.event.id : `competition:${document.competition.id}`;
      await db.sql`INSERT INTO bridge_events (id, revision, document) VALUES (${id}, ${'event' in document ? document.event.revision : document.competition.revision}, ${JSON.stringify(document)}::jsonb)`;
    }
    await db.sql`INSERT INTO bridge_discussions (id, revision, document) VALUES ('board:demo:1', 1, ${JSON.stringify({ comments: [{ id: randomUUID(), author: 'a', nickname: 'n', text: 'hello', createdAt: '2026-11-17T00:00:00.000Z' }] })}::jsonb)`;
    const dry = await migrateLegacyDocuments(db.sql, { dryRun: true });
    assert.equal(dry.flip, 'no');
    assert.equal(dry.events.length, 7);
    assert.equal(dry.verified, 8);
    assert.match(formatMigrationReport(dry), /mode: dry-run/);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM bridge_stages`)[0].n, 0);
    const written = await migrateLegacyDocuments(db.sql, { dryRun: false });
    assert.equal(written.flip, 'normalized');
    assert.equal(written.discussions, 1);
    assert.match(formatMigrationReport(written), /flip: normalized/);
    const legacy = await readLegacyDocuments(db.sql);
    for (const document of legacy) {
      if (!('event' in document)) continue;
      const loaded = await loadStage(db.sql, document.event.id);
      assert.ok(loaded);
      verifyStage(document, loaded.stored);
    }
    const again = await migrateLegacyDocuments(db.sql, { dryRun: false });
    assert.equal(again.flip, 'already-on');
    const clean = structuredClone(stored(fifteen));
    const tampered = structuredClone(clean);
    tampered.event.boards[0].deal = { ...tampered.event.boards[0].deal, N: ['SA'] };
    assert.throws(() => verifyStage(clean, tampered), /deals/);
  } finally {
    await db.close();
  }
});

test('deployed repository keeps writing legacy until the switch flips, then fails closed if legacy moves', async () => {
  const db = await createTestDb();
  try {
    const repo = createNeonRepository(db.sql);
    const event = withDeals(
      createEvent({
        name: '切換',
        kind: 'teams',
        date: '2026-11-01',
        venue: '廳',
        names: ['甲', '乙', '丙', '丁'],
        rounds: 1,
        boardsPerRound: 1,
      }),
    );
    await repo.insertEvent(event);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM bridge_stages`)[0].n, 0);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM bridge_events WHERE document ? 'event'`)[0].n, 1);
    const dry = await migrateLegacyDocuments(db.sql, { dryRun: true });
    assert.equal(dry.flip, 'no');
    assert.equal((await repo.getEvent(event.id)).event.revision, 1);
    const migrated = await migrateLegacyDocuments(db.sql, { dryRun: false });
    assert.equal(migrated.flip, 'normalized');
    const before = JSON.stringify((await db.sql`SELECT document FROM bridge_events WHERE id = ${event.id}`)[0].document);
    const assignment = event.assignments[0];
    await repo.mutateEvent(event.id, score(assignment.id, assignment.boards[0], 8, 1));
    const after = JSON.stringify((await db.sql`SELECT document FROM bridge_events WHERE id = ${event.id}`)[0].document);
    assert.equal(after, before);
    const live = await repo.getEvent(event.id);
    assert.equal(live.event.results[resultKey(assignment.id, assignment.boards[0])].tricks, 8);
    await db.sql`UPDATE bridge_events SET updated_at = now() WHERE id = ${event.id}`;
    await assert.rejects(repo.getEvent(event.id), (error: unknown) => error instanceof DomainError && error.status === 503);
  } finally {
    await db.close();
  }
});

test('merge keeps ids, deal bytes, results and archived rehearsal, and orders stages by date', () => {
  const competition = createCompetition({ name: '老少盃', prefix: '舊', venue: '舊館' }, stageMerge.competitionId);
  const rehearsal = withDeals(
    createEvent(
      { name: '預演', kind: 'pairs', names: ['甲', '乙', '丙', '丁'], date: '2026-10-20', venue: '舊館', rounds: 1, boardsPerRound: 1 },
      stageMerge.stages[0].id,
    ),
  );
  rehearsal.parentEventId = stageMerge.competitionId;
  rehearsal.stageArchived = true;
  rehearsal.stageName = '預演';
  const final = withDeals(
    createEvent(
      { name: '正賽', kind: 'pairs', names: ['甲', '乙', '丙', '丁'], date: '2026-10-20', venue: '舊館', rounds: 1, boardsPerRound: 2 },
      stageMerge.stages[1].id,
    ),
  );
  final.parentEventId = stageMerge.competitionId;
  final.stageName = '正賽';
  const november = withDeals(
    createEvent(
      { name: '11月社內賽', kind: 'pairs', names: ['甲', '乙', '丙', '丁'], date: '2026-11-17', venue: '704室', rounds: 5, boardsPerRound: 3 },
      stageMerge.retiredId,
    ),
  );
  assert.equal(november.boards.length, 15);
  let novemberStored = stored(november);
  novemberStored = applyMutation(
    novemberStored,
    score(november.assignments[0].id, november.assignments[0].boards[0], 9, 1),
  );
  const retired = createCompetition({ name: '11月社內賽', prefix: '', venue: '臺灣大學 二活705' }, stageMerge.retiredId);
  retired.competition.audit.push({ at: '2026-11-01T00:00:00.000Z', action: '舊紀錄', reason: '舊紀錄', revision: 1 });
  retired.requests.push(randomUUID());
  const documents = [stored(rehearsal), stored(final), novemberStored, competition, retired];
  const deals = Object.fromEntries(
    documents.filter((document) => 'event' in document).map((document) => [
      document.event.id,
      document.event.boards.map((board) => JSON.stringify(board.deal)),
    ]),
  );
  const plan = planStageMerge(documents);
  assert.equal(plan.changed, true);
  assert.equal(plan.redirect.from, stageMerge.retiredId);
  assert.equal(plan.redirect.to, stageMerge.competitionId);
  assertMergePreserved(
    documents.filter((document) => 'event' in document),
    plan.documents.filter((document) => 'event' in document),
  );
  for (const [id, hands] of Object.entries(deals)) {
    const event = plan.documents.find((document) => 'event' in document && document.event.id === id);
    assert.ok(event && 'event' in event);
    assert.deepEqual(event.event.boards.map((board) => JSON.stringify(board.deal)), hands);
  }
  const mergedNovember = plan.documents.find((document) => 'event' in document && document.event.id === stageMerge.retiredId);
  assert.ok(mergedNovember && 'event' in mergedNovember);
  assert.equal(mergedNovember.event.parentEventId, stageMerge.competitionId);
  assert.equal(mergedNovember.event.stageName, '11月社內賽');
  assert.equal(mergedNovember.event.venue, '臺灣大學 二活705');
  assert.equal(mergedNovember.event.venueOverride, '臺灣大學 二活705');
  assert.match(mergeReport(plan, true), /venue=臺灣大學 二活705/);
  assert.equal(mergedNovember.event.audit.length, novemberStored.event.audit.length);
  const rehearsalAfter = plan.documents.find((document) => 'event' in document && document.event.id === stageMerge.stages[0].id);
  assert.ok(rehearsalAfter && 'event' in rehearsalAfter);
  assert.equal(rehearsalAfter.event.stageArchived, true);
  const catalog = competitionCatalog(
    plan.documents.filter(isStage).map((document) => eventIndex(document)),
    plan.documents.filter((document): document is StoredCompetition => !isStage(document)),
  );
  const root = catalog.find((item) => item.id === stageMerge.competitionId);
  assert.deepEqual(
    root?.stages.map((stage) => stage.id),
    stageMerge.stages.map((stage) => stage.id),
  );
  assert.equal(root?.prefix, stageMerge.prefix);
  assert.equal(root?.name, stageMerge.name);
  const mergedCompetition = plan.documents.find((document): document is StoredCompetition => !isStage(document) && document.competition.id === stageMerge.competitionId);
  assert.ok(mergedCompetition);
  assert.ok(mergedCompetition.competition.audit.some((entry) => entry.action === '合併賽段'));
  assert.ok(mergedCompetition.competition.audit.some((entry) => entry.action === '舊紀錄'));
  assert.ok(mergedCompetition.requests.includes(retired.requests[0]));
  assert.equal(planStageMerge(plan.documents).changed, false);
});

test('legacy mutations keep only the last 500 request ids', () => {
  const event = createEvent({
    name: '上限',
    kind: 'teams',
    date: '2026-10-18',
    venue: '廳',
    names: ['甲', '乙', '丙', '丁'],
    rounds: 1,
    boardsPerRound: 1,
  });
  const ids = Array.from({ length: 500 }, () => randomUUID());
  const next = applyMutation(
    { event, requests: ids, projection: project(event) },
    mutationSchema.parse({
      action: 'penalty',
      participantId: event.participants[0].id,
      amount: 1,
      reason: '契約驗證',
      revision: event.revision,
      requestId: randomUUID(),
    }),
  );
  assert.equal(next.requests.length, 500);
  assert.equal(next.requests.includes(ids[0]), false);
});

test('microsecond legacy timestamps still flip the storage switch', async () => {
  const db = await createTestDb();
  try {
    const event = withDeals(
      createEvent({
        name: '微秒',
        kind: 'pairs',
        names: ['甲', '乙', '丙', '丁'],
        date: '2026-11-17',
        venue: '廳',
        rounds: 1,
        boardsPerRound: 1,
      }),
    );
    const stamp = '2026-11-17 13:46:19.193888+00';
    await db.sql`INSERT INTO bridge_events (id, revision, document, updated_at)
      VALUES (${event.id}, 1, ${JSON.stringify(stored(event))}::jsonb, ${stamp}::timestamptz)`;
    const report = await migrateLegacyDocuments(db.sql, { dryRun: false });
    assert.equal(report.flip, 'normalized');
    const saved = await db.sql`SELECT legacy_watermark::text AS watermark FROM bridge_storage_switch WHERE id = 1`;
    assert.match(String(saved[0].watermark), /193888/);
  } finally {
    await db.close();
  }
});

test('restore after merge removes the retired competition row', async () => {
  const db = await createTestDb();
  try {
    const competition = createCompetition({ name: '老少盃', prefix: '舊', venue: '舊館' }, stageMerge.competitionId);
    const rehearsal = withDeals(createEvent({
      name: '預演', kind: 'pairs', names: ['甲', '乙', '丙', '丁'], date: '2026-10-20', venue: '舊館', rounds: 1, boardsPerRound: 1,
    }, stageMerge.stages[0].id));
    rehearsal.parentEventId = stageMerge.competitionId;
    rehearsal.stageArchived = true;
    rehearsal.stageName = '預演';
    const final = withDeals(createEvent({
      name: '正賽', kind: 'pairs', names: ['甲', '乙', '丙', '丁'], date: '2026-10-20', venue: '舊館', rounds: 1, boardsPerRound: 1,
    }, stageMerge.stages[1].id));
    final.parentEventId = stageMerge.competitionId;
    final.stageName = '正賽';
    const november = withDeals(createEvent({
      name: '11月社內賽', kind: 'pairs', names: ['甲', '乙', '丙', '丁'], date: '2026-11-17', venue: '704室', rounds: 1, boardsPerRound: 1,
    }, stageMerge.retiredId));
    const deals = canonical(november.boards.map((board) => board.deal));
    const retired = createCompetition({ name: '11月社內賽', prefix: '', venue: '臺灣大學 二活705' }, stageMerge.retiredId);
    for (const document of [stored(rehearsal), stored(final), stored(november), competition, retired]) {
      const id = 'event' in document ? document.event.id : competitionKey(document.competition.id);
      const revision = 'event' in document ? document.event.revision : document.competition.revision;
      await db.sql`INSERT INTO bridge_events (id, revision, document) VALUES (${id}, ${revision}, ${JSON.stringify(document)}::jsonb)`;
    }
    await db.sql`INSERT INTO bridge_discussions (id, revision, document) VALUES ('limit:ip:test', 1, ${JSON.stringify({ minute: 1 })}::jsonb)`;
    assert.equal((await migrateLegacyDocuments(db.sql, { dryRun: false })).flip, 'normalized');
    await commitStageMerge(db.sql);
    await restoreLegacy(db.sql, { dryRun: false });
    const ghost = await db.sql`SELECT id FROM bridge_events WHERE id = ${competitionKey(stageMerge.retiredId)}`;
    assert.equal(ghost.length, 0);
    const kept = await db.sql`SELECT document FROM bridge_events WHERE id = ${stageMerge.retiredId}`;
    const event = (kept[0].document as StoredEvent).event;
    assert.equal(event.venue, '臺灣大學 二活705');
    assert.equal(canonical(event.boards.map((board) => board.deal)), deals);
    const limit = await db.sql`SELECT id FROM bridge_discussions WHERE id = 'limit:ip:test'`;
    assert.equal(limit.length, 1);
  } finally {
    await db.close();
  }
});
