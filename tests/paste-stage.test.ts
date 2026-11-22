import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompetition } from '../lib/competition-record';
import { makeBoard } from '../lib/domain/board-factory';
import { createEvent } from '../lib/domain/event-factory';
import { pasteStage } from '../lib/domain/paste-stage';
import { resultKey, type Kind } from '../lib/model';
import { pasteStageItems, pasteStageSchema } from '../lib/paste-stage-input';
import { project } from '../lib/scoring';
import { seedResultWrites } from '../lib/storage/cell-write';
import { createNeonRepository } from '../lib/storage/neon';
import { saveStage } from '../lib/storage/rows';
import { createTestDb } from './helpers/sql';

const full = { setup: true, roster: true, boards: true, results: true };
const defaults = { ...full, boards: false, results: false };

function fixture(kind: Kind) {
  const source = createEvent({
    kind, name: '來源賽段', names: ['甲', '乙', '丙', '丁'],
    date: '2026-10-19', endDate: '2026-10-20', venue: '原場館', venueOverride: '原賽場',
    rounds: 1, boardsPerRound: 2,
    ...(kind === 'pairs' ? { neuberg: true } : {
      teamMethod: 'bam' as const, bam: { win: 3, draw: 2, loss: 1 },
    }),
  });
  const assignment = source.assignments[0];
  Object.assign(source.participants[0], { players: '賽員甲', captain: '隊長甲', group: 'NS' });
  assignment.playerNames = { N: '賽員甲' };
  source.boards[0] = { ...makeBoard(1), group: 'A', published: true };
  source.results[resultKey(assignment.id, 1)] = {
    assignmentId: assignment.id, board: 1, level: 1, strain: 'NT', doubled: 1,
    declarer: 'N', tricks: 7, lead: '', nsScore: 90, updatedAt: source.updatedAt,
  };
  source.club = {
    enabled: true, mode: 'table', inputRule: 'ns', inputOverrides: { [assignment.id]: 'ns' },
    tokens: { device: 'fixture-only' }, confirmations: { '1:p1': { at: source.updatedAt, forced: false } },
    finalized: [1], publishedAssignments: [assignment.id],
  };
  source.status = 'review';
  source.currentRound = 1;
  source.roundPhase = 'break';
  source.roundTimes = { 1: { startAt: '10:00', endAt: '11:00' } };
  source.penalties = { [source.participants[0].id]: 1 };
  source.winAward = { enabled: true, win: 2, draw: 1, loss: 0 };
  source.awardPlaces = 3;
  source.awardDescription = '前三名';
  source.movementDescription = '賽程';
  source.movementImported = true;
  source.audienceRefreshSeconds = 20;
  source.danmakuDefaultEnabled = true;
  source.showScoreCandles = true;
  source.stageArchived = true;
  source.stageOrder = 2;
  source.organizerId = 'source-organizer';
  source.demo = true;
  source.revision = 5;
  return source;
}

for (const kind of ['pairs', 'teams'] as const) {
  for (const setup of [false, true]) for (const roster of [false, true]) for (const boards of [false, true]) {
    check({ setup, roster, boards, results: false });
  }
  check(full);

  function check(include: typeof full) {
    test(`${kind} paste ${Object.entries(include).filter(([, on]) => on).map(([key]) => key).join('+') || 'format only'}`, () => {
      const source = fixture(kind);
      const original = structuredClone(source);
      const stage = pasteStage(source, { name: '新賽段', include, sameCompetition: true });
      assert.deepEqual(source, original);
      assert.notEqual(stage.id, source.id);
      assert.equal(stage.name, '新賽段');
      assert.equal(stage.stageName, '新賽段');
      assert.equal(stage.demo, false);
      assert.equal(stage.revision, 1);
      assert.equal(stage.stageArchived, false);
      assert.equal(stage.stageOrder, undefined);
      assert.equal(stage.organizerId, undefined);
      assert.equal(stage.venueOverride, source.venueOverride);
      assert.equal(stage.date, source.date);
      assert.equal(stage.endDate, source.endDate);
      assert.equal(stage.rankingMode, source.rankingMode);
      assert.equal(stage.neuberg, source.neuberg);
      assert.deepEqual(stage.bam, source.bam);
      const setupKeys = ['movementDescription', 'movementImported', 'winAward', 'awardPlaces',
        'awardDescription', 'audienceRefreshSeconds', 'danmakuDefaultEnabled', 'showScoreCandles'] as const;
      for (const key of setupKeys) assert.deepEqual(stage[key], include.setup ? source[key] : undefined);
      assert.equal(stage.rounds, include.setup ? source.rounds : 0);
      assert.equal(stage.boardsPerRound, include.setup ? source.boardsPerRound : 0);
      assert.equal(stage.assignments.length, include.setup ? source.assignments.length : 0);
      if (include.setup) {
        assert.deepEqual(stage.assignments.map(({ playerNames, ...assignment }) => assignment),
          source.assignments.map(({ playerNames, ...assignment }) => assignment));
        assert.deepEqual(stage.assignments[0].playerNames, include.roster ? source.assignments[0].playerNames : undefined);
      }
      if (include.roster) assert.deepEqual(stage.participants, source.participants);
      else if (include.setup) {
        assert.deepEqual(stage.participants.map(p => p.id), source.participants.map(p => p.id));
        assert.deepEqual(stage.participants[0], {
          id: source.participants[0].id, group: 'NS', name: kind === 'pairs' ? '第 1 對' : '第 1 隊', players: '',
        });
      } else assert.deepEqual(stage.participants, []);
      if (include.boards || include.setup) {
        assert.deepEqual(stage.boards, source.boards.map(board => ({
          ...board,
          ...(include.results ? {} : { published: false }),
          ...(include.boards ? {} : { deal: { N: [], E: [], S: [], W: [] } }),
        })));
      } else assert.deepEqual(stage.boards, []);
      assert.deepEqual(stage.results, include.results ? source.results : {});
      assert.deepEqual(stage.penalties, include.results ? source.penalties : {});
      assert.equal(stage.status, include.results ? source.status : 'live');
      for (const key of ['currentRound', 'roundPhase', 'roundTimes'] as const) {
        assert.deepEqual(stage[key], include.results ? source[key] : undefined);
      }
      const club = source.club!;
      assert.deepEqual(stage.club, include.setup ? {
        enabled: club.enabled, mode: club.mode, inputRule: club.inputRule, inputOverrides: club.inputOverrides, tokens: {},
        confirmations: include.results ? club.confirmations : {}, finalized: include.results ? club.finalized : [],
        ...(include.results ? { publishedAssignments: club.publishedAssignments } : {}),
      } : undefined);
      assert.deepEqual(stage.audit, [{
        at: stage.updatedAt, action: '貼上賽段', reason: '自既有賽段貼上', revision: 1,
        detail: `來源賽段 ${source.id}，版本 ${source.revision}；帶入：${Object.entries(pasteStageItems)
          .filter(([key]) => include[key as keyof typeof include]).map(([, label]) => label).join('、')}`,
      }]);
      const projection = project(stage);
      if (include.results) assert.deepEqual(projection, project(source));
      stage.boards[0]?.deal.N.push('SA');
      if (stage.participants[0]) stage.participants[0].name = '已修改';
      stage.assignments[0]?.boards.push(999);
      for (const result of Object.values(stage.results)) result.nsScore = 999;
      assert.deepEqual(source, original);
    });
  }
}

test('paste API accepts only strict input and requires all three dependencies for results', () => {
  const input = { sourceId: 'source', sourceRevision: 1, name: ' 階段 ', include: defaults, revision: 1 };
  assert.equal(pasteStageSchema.parse(input).name, '階段');
  for (const key of ['setup', 'roster', 'boards'] as const)
    assert.equal(pasteStageSchema.safeParse({ ...input, include: { ...full, [key]: false } }).success, false);
  assert.equal(pasteStageSchema.safeParse({ ...input, include: full, extra: true }).success, false);
  assert.equal(pasteStageSchema.safeParse({ ...input, include: { ...full, extra: true } }).success, false);
  assert.equal(pasteStageSchema.safeParse({ ...input, sourceRevision: 0 }).success, false);
  assert.equal(pasteStageSchema.safeParse({ ...input, name: '甲'.repeat(81) }).success, false);
});

test('Swiss retains scheduled pairings and strips the score basis when results are excluded', () => {
  const source = fixture('teams');
  source.swiss = { mode: 'current', publications: [{
    round: 1, sourceRound: 0, sourceRevision: source.revision, at: source.updatedAt, pairs: [['t1', 't2'], ['t3', 't4']],
    basis: [{ id: 'a', vpA: 10, vpB: 10 }], byeBasis: [{ round: 1, participantId: 't1', vp: 12 }],
    scores: [{ id: 't1', score: 10, ready: true }],
  }] };
  const options = { name: '瑞士賽', sameCompetition: false };
  const stage = pasteStage(source, { ...options, include: defaults });
  assert.equal(stage.venueOverride, undefined);
  assert.deepEqual(stage.swiss, {
    ...source.swiss,
    publications: source.swiss.publications.map(p => ({ ...p, basis: [], byeBasis: [], scores: [] })),
  });
  assert.deepEqual(pasteStage(source, { ...options, include: full }).swiss, source.swiss);
});

test('knockout setup retains the bracket, with decisions carried only with results', () => {
  const source = createEvent({
    kind: 'teams', teamFormat: 'knockout', name: '淘汰賽', date: '2026-10-19', venue: '場館',
    names: ['甲', '乙'], rounds: 1, boardsPerRound: 2,
  });
  const knockout = source.knockout!;
  knockout.decisions[knockout.nodes[0].id] = { winner: 't1', loser: 't2', method: 'director' };
  const options = { name: '新淘汰賽', sameCompetition: true };
  const stage = pasteStage(source, { ...options, include: defaults });
  assert.deepEqual(stage.knockout, { ...knockout, decisions: {} });
  assert.deepEqual(pasteStage(source, { ...options, include: full }).knockout, knockout);
  const empty = pasteStage(source, { ...options, include: { ...defaults, setup: false } });
  assert.equal(empty.teamFormat, 'knockout');
  assert.equal(empty.knockout, undefined);
  project(stage);
  project(empty);
});

for (const legacy of [false, true]) test(`normalized paste preserves source rows (${legacy ? 'legacy root' : 'independent competition'})`, async () => {
  const { db, sql, close } = await createTestDb();
  try {
    const repo = createNeonRepository(sql);
    const source = fixture('teams');
    if (legacy) await saveStage(sql, { event: source, projection: project(source), requests: [] }, seedResultWrites(source));
    else await repo.insertEvent(source);
    const before = await repo.getEvent(source.id);
    const boardRows = () => db.query('SELECT *, xmin::text FROM bridge_boards WHERE event_id = $1 ORDER BY ordinal', [source.id]);
    const rows = await boardRows();
    const target = legacy ? await repo.getCompetition(source.id) :
      await repo.insertCompetition(createCompetition({ name: '目標賽事', venue: '新場館' }));
    const stage = pasteStage(before.event, { name: '貼上結果', include: full, sameCompetition: legacy });
    await repo.insertStage(target.competition.id, stage, target.competition.revision);
    const saved = await repo.getEvent(stage.id);
    assert.equal(saved.event.parentEventId, target.competition.id);
    assert.deepEqual(saved.event.boards, before.event.boards);
    assert.deepEqual(saved.event.results, before.event.results);
    assert.deepEqual(saved.event.participants, before.event.participants);
    const after = await repo.getEvent(source.id);
    assert.equal(after.event.revision, before.event.revision);
    assert.deepEqual(after.event.boards, before.event.boards);
    assert.deepEqual(after.event.participants, before.event.participants);
    assert.deepEqual(after.event.results, before.event.results);
    assert.deepEqual((await boardRows()).rows, rows.rows);
  } finally {
    await close();
  }
});
