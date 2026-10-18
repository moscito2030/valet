import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { createSchema } from '../lib/model';
const base = { name: 'Deferred pairs', kind: 'pairs' as const, names: ['A','B','C','D','E','F'], date: '2026-10-18', venue: '', boardsPerRound: 2 };
for (const rankingMode of ['single', 'double'] as const) test(`${rankingMode} winner creates only roster then accepts an explicit movement`, () => {
  const event = createEvent({ ...base, rankingMode });
  assert.equal(event.rounds, 0);
  assert.deepEqual(event.assignments, []);
  assert.deepEqual(event.boards, []);
  assert.deepEqual(event.participants.map(p => p.group), rankingMode === 'double' ? ['NS','NS','NS','EW','EW','EW'] : Array(6).fill(undefined));
  const saved = applyMutation({event, requests: [], projection: project(event)}, {action:'movement-plan', revision:1, requestId:randomUUID(), reason:'Choose schedule after creation', plan:rankingMode === 'double' ? 'double-barometer' : 'howell-3-5', rounds:rankingMode === 'double' ? 3 : 5, boardsPerRound:2});
  assert.equal(saved.event.assignments.length, rankingMode === 'double' ? 9 : 15);
  assert.deepEqual(saved.event.participants.map(p=>p.id), event.participants.map(p=>p.id));
  assert.deepEqual(saved.event.participants.map(p=>p.group), event.participants.map(p=>p.group));
});
test('ranking-only creation rejects invalid groups and conflicting schedules', () => {
  for (const input of [
    {...base,rankingMode:'double',names:['A','B','C','D','E']},
    {...base,rankingMode:'double',names:['A','B','C','D']},
    {...base,rankingMode:'single',rounds:3},
    {...base,rankingMode:'single',movementPlan:'double-barometer'},
    {...base,kind:'teams',rankingMode:'double'},
  ]) assert.equal(createSchema.safeParse(input).success,false);
});

test('pair roster accepts 80 pairs and rejects 81 while teams remain capped at 32', () => {
  const names = Array.from({length:80}, (_,i)=>`Pair ${i+1}`);
  for (const rankingMode of ['single','double'] as const) {
    const event = createEvent({...base,names,rankingMode});
    assert.equal(event.participants.length,80);
    assert.equal(event.assignments.length,0);
    assert.equal(createSchema.safeParse({...base,names:[...names,'Extra'],rankingMode}).success,false);
  }
  assert.equal(createSchema.safeParse({...base,kind:'teams',names:names.slice(0,32)}).success,true);
  assert.equal(createSchema.safeParse({...base,kind:'teams',names:names.slice(0,33)}).success,false);
});
