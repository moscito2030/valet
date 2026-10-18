import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import type { Mutation, StoredEvent } from '../lib/model';
test('restore returns unscored cancellations to missing, and restores actual contracts including pass', () => {
 const event=createEvent({name:'Restore',kind:'pairs',names:['A','B','C','D'],rounds:1,boardsPerRound:2,date:'2026-10-18',venue:''});
 let state:StoredEvent={event,projection:project(event),requests:[]};
 const a=event.assignments[0], board=a.boards[0], key=a.id+':'+board;
 const run=(payload:object)=>state=applyMutation(state,{...payload,revision:state.event.revision,requestId:randomUUID(),reason:'test restore'} as Mutation);
 const ruling=(cancelled:boolean)=>run({action:'ruling',assignmentId:a.id,board,cancelled});
 ruling(true); ruling(false); assert.equal(state.event.results[key],undefined);
 for (const level of [0,2]) {
  run({action:'results',results:[{assignmentId:a.id,board,level,strain:'H',declarer:'E',doubled:1,tricks:level ? 8 : 0,lead:level ? 'SA' : ''}]});
  const original=state.event.results[key]; ruling(true); ruling(false);
  const restored=state.event.results[key];
  assert.equal(restored.level,original.level); assert.equal(restored.nsScore,original.nsScore); assert.equal(restored.lead,original.lead);
 }
});
