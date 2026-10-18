import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { competitionCatalog, inheritCompetition } from '../lib/competitions';
import { createCompetition, findCompetition, saveCompetitionRecord, updateCompetition, advanceCompetition, isStage, competitionSchema } from '../lib/competition-record';
import { deletionTargets } from '../lib/competition-deletion';
import { project } from '../lib/scoring';
import { mutationSchema } from '../lib/model';
import { canMutate } from '../lib/mutation-permissions';

function setup() {
  const event = createEvent({ name: '俱樂部盃', kind: 'pairs', date: '2026-10-16', venue: '臺北', names: ['A', 'B', 'C', 'D'], rounds: 1, boardsPerRound: 2 });
  return { event, projection: project(event), requests: [] as string[] };
}
const command = (extra: object, revision = 1) => mutationSchema.parse({ action: 'settings', status: 'live', revision, requestId: randomUUID(), reason: '修改賽段資訊', ...extra });

test('empty competitions have independent metadata, no invented stage/date, and no public audit', () => {
  const record = createCompetition({ name: '空賽事', venue: '臺北' });
  const c = competitionCatalog([], [record])[0];
  assert.equal(c.name, '空賽事'); assert.equal(c.venue, '臺北');
  assert.deepEqual(c.stages, []); assert.deepEqual(c.dates, []);
  assert.equal(c.date, ''); assert.equal(c.endDate, '');
  assert.ok(!('audit' in c)); assert.ok(!('requests' in c));
  assert.equal(competitionSchema.safeParse({ name: '空賽事', date: '2026-10-16' }).success, false);
});

test('extracting legacy metadata preserves IDs, scores, projection and device credentials; migration fences stale writes', () => {
  let stage = setup(); const a = stage.event.assignments[0];
  stage = applyMutation(stage, { action: 'results', revision: 1, requestId: randomUUID(), reason: '測試成績', results: [{ assignmentId: a.id, board: a.boards[0], level: 3, strain: 'NT', doubled: 1, declarer: 'N', tricks: 9, lead: '' }] });
  stage.event.club = { enabled: true, tokens: { p1: 'existing-hash' }, confirmations: {}, finalized: [] };
  const before = structuredClone(stage);
  const fallback = findCompetition([stage], stage.event.id);
  const metadata = advanceCompetition(fallback, fallback.competition.revision, '分離賽事資訊');
  const saved = saveCompetitionRecord([stage], metadata);
  const migrated = saved.filter(isStage)[0];
  assert.deepEqual(stage, before);
  assert.deepEqual(migrated, { ...before, event: { ...before.event, revision: before.event.revision + 1 } });
  assert.deepEqual(findCompetition(saved, stage.event.id), metadata);
  const later = saveCompetitionRecord(saved, advanceCompetition(metadata, metadata.competition.revision, '修改共用資訊'));
  assert.deepEqual(later.filter(isStage)[0], migrated);
});

test('shared edits are idempotent, reject stale versions and leave stage names/dates/scores unchanged', () => {
  const stage = setup(), record = createCompetition({ name: '賽事名稱', venue: '臺北' }, stage.event.id);
  const input = { name: '新賽事名稱', prefix: '第十屆', venue: '新場地', revision: 1, requestId: randomUUID() };
  const updated = updateCompetition(record, input);
  assert.equal(updateCompetition(updated, input), updated);
  assert.throws(() => updateCompetition(updated, { ...input, requestId: randomUUID() }), /更新/);
  const inherited = inheritCompetition(stage, updated.competition);
  assert.equal(inherited.event.venue, '新場地');
  assert.equal(inherited.event.prefix, '第十屆');
  assert.equal(inherited.event.name, stage.event.name);
  assert.equal(inherited.event.date, stage.event.date);
  assert.equal(inherited.event.revision, stage.event.revision);
  assert.deepEqual(inherited.event.results, stage.event.results);
  assert.equal(competitionCatalog([stage], [updated])[0].name, input.name);
});

test('venue overrides including explicit empty values survive shared edits and can be reset to inheritance', () => {
  const stage = setup(), record = createCompetition({ name: '俱樂部盃', venue: '共用地點' }, stage.event.id);
  for (const venue of ['分館', '']) {
    const mutation = command({ venueOverride: venue });
    assert.equal(canMutate('admin', mutation), false); assert.equal(canMutate('director', mutation), true);
    const changed = applyMutation(stage, mutation);
    assert.equal(inheritCompetition(changed, record.competition).event.venue, venue);
    assert.equal(competitionCatalog([changed], [record])[0].stages[0].venue, venue);
    const reset = applyMutation(changed, command({ venueOverride: null }, changed.event.revision));
    assert.equal(reset.event.venueOverride, undefined);
    assert.equal(inheritCompetition(reset, record.competition).event.venue, '共用地點');
    assert.deepEqual(reset.event.assignments, stage.event.assignments);
  }
  const created = createEvent({ name: '另設場地', kind: 'teams', date: '2026-10-18', venue: '共用地點', venueOverride: '分館', names: ['甲', '乙', '丙'] });
  assert.equal(created.venueOverride, '分館');
});

test('removing first or final legacy stage leaves independently deletable competition and surviving stage IDs', () => {
  const first = setup(), second = setup(); second.event.parentEventId = first.event.id;
  const record = findCompetition([first, second], first.event.id);
  const afterFirst = saveCompetitionRecord([second], advanceCompetition(record, record.competition.revision, '刪除賽段'));
  const c = competitionCatalog(afterFirst.filter(isStage), [findCompetition(afterFirst, first.event.id)])[0];
  assert.equal(c.stages.length, 1); assert.equal(c.stages[0].id, second.event.id);
  assert.equal(inheritCompetition(second, findCompetition(afterFirst, first.event.id).competition).event.venue, first.event.venue);
  const empty = findCompetition(afterFirst, first.event.id);
  assert.deepEqual(competitionCatalog([], [empty])[0].stages, []);
  const request = { id: c.id, revision: empty.competition.revision, confirmName: c.name, stages: [] };
  assert.equal(deletionTargets([empty], { competitions: [request] }).length, 1);
  assert.throws(() => deletionTargets([empty], { competitions: [{ ...request, revision: 1 }] }), /更新/);
  assert.throws(() => deletionTargets(afterFirst, { competitions: [request] }), /更新/);
  assert.throws(() => findCompetition([second], second.event.id), /找不到/);
});

test('all stage names and date ranges can be edited independently, including legacy first stage', () => {
  const stage = setup();
  const renamed = applyMutation(stage, command({ stageName: '上午預賽', date: '2026-11-02', endDate: '2026-11-04' }));
  assert.equal(renamed.event.name, stage.event.name);
  assert.equal(renamed.event.stageName, '上午預賽');
  assert.deepEqual(renamed.event.results, stage.event.results);
  const record = createCompetition({ name: '俱樂部盃' }, stage.event.id);
  const c = competitionCatalog([renamed], [record])[0];
  assert.equal(c.date, '2026-11-02'); assert.equal(c.endDate, '2026-11-04');
  assert.equal(canMutate('admin', command({ stageName: '上午' })), false);
});
