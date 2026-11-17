import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompetition } from '../lib/competition-record';
import { competitionCatalog, competitionStatusLabel } from '../lib/competitions';
import { eventIndex } from '../lib/event-index';
import { createEvent } from '../lib/events';
import type { BridgeEvent } from '../lib/model';
import { project } from '../lib/scoring';

const stage = (
  status: BridgeEvent['status'],
  rounds: number,
  stageArchived?: boolean,
) => ({ status, rounds, ...(stageArchived ? { stageArchived } : {}) });

test('aggregated event status ignores archived stages', () => {
  const finished = stage('finished', 8);
  const rehearsal = stage('review', 2, true);
  assert.equal(competitionStatusLabel({}, [finished, rehearsal]), '已結束');
  assert.equal(
    competitionStatusLabel({}, [finished, stage('live', 2, true)]),
    '已結束',
    'an archived live stage does not keep a finished event in progress',
  );
  assert.equal(competitionStatusLabel({}, [stage('live', 8), rehearsal]), '進行中');
  assert.equal(
    competitionStatusLabel({}, [stage('review', 8), finished, rehearsal]),
    '成績覆核中',
  );
  assert.equal(
    competitionStatusLabel({}, [stage('live', 0), stage('review', 8, true)]),
    '待設定賽程',
  );
  assert.equal(
    competitionStatusLabel({}, [stage('finished', 8), stage('live', 0)]),
    '進行中',
  );
  assert.equal(competitionStatusLabel({}, []), '尚未安排賽段');
  assert.equal(
    competitionStatusLabel({}, [stage('review', 2, true), stage('finished', 8, true)]),
    '已封存 · 僅裁判可見',
    'every stage archived: same label as archiving the competition, not the stages own statuses',
  );
  assert.equal(
    competitionStatusLabel({ archived: true }, [stage('live', 8)]),
    '已封存 · 僅裁判可見',
  );
  assert.equal(
    competitionStatusLabel({}, [{ status: 'finished', rounds: 8 }]),
    '已結束',
    'a missing archive flag still counts the stage',
  );
});

function indexed(id: string, overrides: Partial<BridgeEvent> = {}) {
  const event = createEvent(
    {
      name: '老少盃',
      kind: 'pairs',
      date: '2026-11-15',
      venue: '臺大',
      names: ['甲', '乙', '丙', '丁'],
      rounds: 1,
      boardsPerRound: 1,
    },
    id,
  );
  Object.assign(event, overrides);
  return event;
}

test('catalog status skips an archived rehearsal and does not rewrite stage documents', () => {
  const final = indexed('lao-shao', { status: 'finished', stageName: '正式賽', date: '2026-11-15' });
  const rehearsal = indexed('lao-shao-rehearsal', {
    parentEventId: final.id,
    stageName: '預演',
    status: 'review',
    stageArchived: true,
    date: '2026-11-14',
  });
  const indexes = [final, rehearsal].map((event) =>
    eventIndex({ event, projection: project(event), requests: [] }),
  );
  const before = structuredClone([final, rehearsal]);
  const director = competitionCatalog(indexes, [], true)[0];
  const audience = competitionCatalog(indexes, [], false)[0];

  assert.equal(director.statusLabel, '已結束');
  assert.equal(audience.statusLabel, '已結束');
  assert.equal(audience.statusLabel, competitionStatusLabel(audience, [final, rehearsal].map((event) => ({
    stageArchived: event.stageArchived,
    status: event.status,
    rounds: event.rounds,
  }))));
  assert.ok(director.stages.some((s) => s.id === rehearsal.id && s.stageArchived && s.status === 'review'));
  assert.ok(!audience.stages.some((s) => s.id === rehearsal.id));
  assert.deepEqual(audience.dates, ['2026-11-15']);
  assert.deepEqual(director.dates, ['2026-11-14', '2026-11-15']);
  assert.deepEqual([final, rehearsal], before);
  assert.equal(rehearsal.status, 'review');
  assert.deepEqual(rehearsal.boards[0].deal, { N: [], E: [], S: [], W: [] });
});

test('a catalog with only archived stages is archived, and an empty catalog is not', () => {
  const only = indexed('sealed', { stageArchived: true, status: 'review', stageName: '預演' });
  const indexes = [eventIndex({ event: only, projection: project(only), requests: [] })];
  const audience = competitionCatalog(indexes, [], false)[0];
  assert.equal(audience.stages.length, 0);
  assert.equal(audience.date, '');
  assert.equal(audience.statusLabel, '已封存 · 僅裁判可見');
  assert.equal(competitionCatalog(indexes, [], true)[0].statusLabel, '已封存 · 僅裁判可見');
  assert.equal(only.status, 'review');

  const empty = createCompetition({ name: '空賽事', venue: '臺大' });
  assert.equal(competitionCatalog([], [empty])[0].statusLabel, '尚未安排賽段');

  const live = indexed('open-cup', { status: 'live' });
  const archived = createCompetition({ name: '老少盃', venue: '臺大' }, live.id);
  archived.competition.archived = true;
  const hidden = competitionCatalog(
    [eventIndex({ event: live, projection: project(live), requests: [] })],
    [archived],
  )[0];
  assert.equal(hidden.statusLabel, '已封存 · 僅裁判可見');
  assert.equal(live.status, 'live');
  assert.equal(live.boards.length, 1);
});
