import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, type StoredEvent } from '../lib/model';
import { competitionCatalog, appendStage, inheritCompetition } from '../lib/competitions';
import { eventIndex } from '../lib/event-index';
import { project } from '../lib/scoring';
import { canMutate } from '../lib/mutation-permissions';
import { dateRangeLabel, dateRangeMonths, includesDate } from '../lib/date-range';

const input = { name: '跨日賽段', kind: 'teams' as const, date: '2026-10-30', endDate: '2026-11-02', venue: '', names: ['A', 'B', 'C', 'D'], rounds: 1, boardsPerRound: 2 };
const store = (event = createEvent(input)): StoredEvent => ({ event, projection: project(event), requests: [] });
const settings = (extra: object, revision = 1) => mutationSchema.parse({ action: 'settings', status: 'live', revision, requestId: randomUUID(), reason: '日期區間驗證', ...extra });

test('stage ranges validate real dates and order; updates preserve scores and can return to a single day', () => {
  assert.throws(() => createEvent({ ...input, endDate: '2026-10-29' }), /結束日期/);
  assert.throws(() => createEvent({ ...input, endDate: '2026-11-31' }), /日期/);
  const original = store();
  assert.equal(eventIndex(original).event.endDate, input.endDate);
  assert.throws(() => applyMutation(original, settings({ date: '2026-11-03' })), /結束日期/);
  assert.throws(() => applyMutation(original, settings({ endDate: '2026-10-29' })), /結束日期/);
  assert.equal(original.event.date, input.date);
  const extended = applyMutation(original, settings({ endDate: '2026-11-05' }));
  assert.equal(extended.event.endDate, '2026-11-05');
  assert.deepEqual(extended.event.assignments, original.event.assignments);
  assert.deepEqual(extended.event.results, original.event.results);
  assert.equal(canMutate('admin', settings({ endDate: '2026-11-05' })), false);
  assert.equal(canMutate('director', settings({ endDate: null })), true);
  const single = applyMutation(extended, settings({ date: '2026-11-10', endDate: null }, extended.event.revision));
  assert.equal(single.event.endDate, undefined);
  assert.equal(dateRangeLabel(single.event), '2026-11-10');
});

test('stage date ranges remain independent and catalog includes full extent without filling gaps', () => {
  const next = appendStage(store(), createEvent({ ...input, date: '2026-12-01', endDate: '2026-12-03' }), 1, '預賽');
  assert.equal(inheritCompetition(next.stage, next.root.event).event.endDate, '2026-12-03');
  const c = competitionCatalog([eventIndex(next.root), eventIndex(next.stage)])[0];
  assert.equal(c.date, '2026-10-30');
  assert.equal(c.endDate, '2026-12-03');
  for (const date of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-12-03'])
    assert.ok(c.stages.some(s => includesDate(s, date)), date);
  for (const date of ['2026-10-29', '2026-11-15', '2026-12-04'])
    assert.equal(c.stages.some(s => includesDate(s, date)), false, date);
  assert.deepEqual(dateRangeMonths(c.stages), ['2026-10', '2026-11', '2026-12']);
  assert.equal(dateRangeLabel(c.stages[0]), '2026-10-30 ～ 2026-11-02');
});

test('legacy single-day stages and leap/year boundaries work without expanding every day', () => {
  const { endDate: _, ...legacyInput } = input;
  const legacy = createEvent(legacyInput);
  assert.equal(legacy.endDate, undefined);
  assert.equal(includesDate(legacy, legacy.date), true);
  assert.equal(includesDate(legacy, '2026-10-31'), false);
  const leap = createEvent({ ...input, date: '2028-02-28', endDate: '2028-03-01' });
  assert.equal(includesDate(leap, '2028-02-29'), true);
  assert.deepEqual(dateRangeMonths([{ date: '2026-12-31', endDate: '2027-02-01' }]), ['2026-12', '2027-01', '2027-02']);
  assert.equal(dateRangeLabel({ date: legacy.date, endDate: legacy.date }), legacy.date);
});
