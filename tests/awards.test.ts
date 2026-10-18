import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema } from '../lib/model';
import { project } from '../lib/scoring';
import { audienceEvent } from '../lib/club-view';
import { awardPlacesFor, awardRangeDescription } from '../lib/awards';

test('directional award settings preserve legacy defaults, zero and public projection', () => {
  const event=createEvent({name:'Awards',kind:'pairs',rankingMode:'double',names:['A','B','C','D','E','F'],date:'2026-10-19',venue:''});
  event.awardPlaces=2;
  assert.equal(awardPlacesFor(event,'NS'),2);
  assert.equal(awardPlacesFor(event,'EW'),2);
  const cmd=mutationSchema.parse({action:'settings',status:'live',awardPlacesNS:0,awardPlacesEW:1,revision:event.revision,requestId:randomUUID(),reason:'分方向給獎'});
  const result=applyMutation({event,projection:project(event),requests:[]},cmd);
  const view=audienceEvent(result.event,result.projection);
  assert.equal(awardPlacesFor(view,'NS'),0);
  assert.equal(awardPlacesFor(view,'EW'),1);
  assert.match(awardRangeDescription(view),/NS：不給獎；EW：前 1 名/);
  assert.equal(result.event.awardPlaces,2);
  assert.equal(event.awardPlacesNS,undefined);
  for(const value of [-1,33,1.5]) assert.equal(mutationSchema.safeParse({...cmd,awardPlacesNS:value}).success,false);
  const single={...event,participants:event.participants.map(p=>({...p,group:undefined}))};
  assert.throws(()=>applyMutation({event:single,projection:project(single),requests:[]},cmd),/Double Winner/);
  assert.equal(awardPlacesFor({...single,awardPlacesNS:0},'NS'),2);
});
