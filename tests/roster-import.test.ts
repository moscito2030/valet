import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { mutationSchema } from '../lib/model';
import { parseRosters, exportRosters } from '../lib/roster-import';
function setup() {
  const event = createEvent({name:'名單匯入',kind:'teams',date:'2026-10-17',venue:'',names:['A','B','C','D'],rounds:1,boardsPerRound:2});
  return {event, projection:project(event), requests:[] as string[]};
}
test('roster CSV updates listed teams atomically and preserves scores and unlisted teams', () => {
  const original=setup(), id=original.event.participants[0].id;
  const command=mutationSchema.parse({action:'rosters-import',revision:1,requestId:randomUUID(),reason:'更新名單',csv:'teamId,captain,players\n'+id+',隊長,甲、乙'});
  if (command.action !== 'rosters-import') throw new Error('Unexpected action');
  const next=applyMutation(original,command);
  assert.equal(next.event.participants[0].players,'甲、乙');
  assert.equal(next.event.participants[0].captain,'隊長');
  assert.deepEqual(next.event.participants.slice(1),original.event.participants.slice(1));
  assert.deepEqual(next.event.results,original.event.results);
  assert.equal(next.event.audit.at(-1)?.action,'匯入隊伍賽員名單');
  assert.equal(applyMutation(next,command),next);
  assert.throws(()=>applyMutation(original,{...command,csv:command.csv+'\nunknown,,丙'}),/找不到/);
  assert.notEqual(original.event.participants[0].players,'甲、乙');
});
test('roster import protects seated players within their own team and validates input',()=>{
  const {event}=setup(), a=event.assignments[0];
  event.participants.find(p=>p.id===a.ns)!.players='甲';
  a.playerNames={N:'甲'};
  assert.throws(()=>parseRosters('teamId,captain,players\n'+a.ns+',,',event),/入座名單/);
  assert.doesNotThrow(()=>parseRosters('teamId,captain,players\n'+a.ew+',,',event));
  assert.throws(()=>parseRosters('teamId,captain,players\n'+a.ns+',,甲、甲',event),/重複/);
  assert.throws(()=>parseRosters('teamId,captain,players\n'+a.ew+',,\n'+a.ew+',,',event),/重複/);
  assert.throws(()=>parseRosters('teamId,captain,players\n'+a.ew+',,', {...event,kind:'pairs'}),/隊制/);
});
test('roster export escapes spreadsheet formulas and round trips names and empty rosters',()=>{
  const {event}=setup();
  event.participants[0].captain='=1+1';
  event.participants[0].players="'甲、乙";
  const csv=exportRosters(event);
  assert.ok(csv.includes('"\'=1+1"'));
  const rows=parseRosters(csv,event);
  assert.equal(rows[0].captain,'=1+1');
  assert.deepEqual(rows[0].players,["'甲",'乙']);
});
