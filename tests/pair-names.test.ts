import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { canMutate } from '../lib/mutation-permissions';
import { clubView } from '../lib/club-view';

const command = (revision=1, name='甲／乙', participantId='p1') => mutationSchema.parse({action:'pair-name',revision,requestId:randomUUID(),reason:'姓名更正',participantId,name});
function fixture() {
  const event=createEvent({name:'Rename QA',kind:'pairs',names:['Pair A','Pair B','Pair C','Pair D'],date:'2026-10-18',venue:'',rounds:2,boardsPerRound:1});
  return {event,projection:project(event),requests:[]} as StoredEvent;
}
test('renaming finished pairs preserves IDs, scores, schedule, club access and approval while updating views',()=>{
  let s=fixture();const a=s.event.assignments[0];
  s.event.status='finished';s.event.currentRound=1;
  s.event.results[`${a.id}:${a.boards[0]}`]={assignmentId:a.id,board:a.boards[0],level:3,strain:'NT',doubled:1,declarer:'N',tricks:9,lead:'',nsScore:400,updatedAt:'test'};
  s.event.club={enabled:true,tokens:{p1:'a'.repeat(64)},confirmations:{'1:p1':{at:'test',forced:false}},finalized:[1]};
  const before=structuredClone(s.event);const c=command(s.event.revision,'  王甲／李乙  ');
  s=applyMutation(s,c);
  assert.equal(s.event.participants[0].name,'王甲／李乙');
  assert.deepEqual(s.event.assignments,before.assignments);assert.deepEqual(s.event.results,before.results);assert.deepEqual(s.event.club,before.club);
  assert.deepEqual(s.event.participants.map(p=>p.id),before.participants.map(p=>p.id));
  assert.equal(clubView(s.event,'p1').pairName,'王甲／李乙');
  assert.match(s.event.audit.at(-1)!.detail!,/Pair A.*王甲／李乙/);
  assert.equal(applyMutation(s,c),s);
  assert.throws(()=>applyMutation(s,{...c,requestId:randomUUID()}),/版本|更新/);
});
test('pair rename is director-only and rejects blank, duplicate, unknown or team targets',()=>{
  const c=command();assert.equal(canMutate('director',c),true);assert.equal(canMutate('admin',c),false);assert.equal(canMutate(null,c),false);
  assert.throws(()=>command(1,'  '));assert.throws(()=>command(1,'甲'.repeat(61)));
  const s=fixture();
  assert.throws(()=>applyMutation(s,command(1,'Pair B')),/重複/);
  assert.throws(()=>applyMutation(s,command(1,'名字','missing')),/找不到/);
  assert.throws(()=>applyMutation({...s,event:{...s.event,kind:'teams'}},c),/雙人賽/);
  assert.equal(s.event.participants[0].name,'Pair A');
});
