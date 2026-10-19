import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';
import { project, teamStandingsThroughRound } from '../lib/scoring';
test('equal scores display by numeric participant ID, not name or roster order',()=>{
 for(const kind of ['pairs','teams'] as const){
 const e=createEvent({name:'Tie order',kind,names:Array.from({length:12},(_,i)=>String(12-i)),date:'2026-10-20',venue:''});
 const ids=e.participants.map(p=>p.id);
 e.participants.reverse();
 const projection=project(e);
 assert.deepEqual(projection.standings.map(p=>p.id),ids);
 assert.ok(projection.standings.every(p=>p.rank===1));
 if(kind==='teams')assert.deepEqual(teamStandingsThroughRound({...e,projection},1).map(p=>p.id),ids);
 e.penalties={[ids[0]]:1};
 const penalized=project(e).standings;
 assert.equal(penalized.at(-1)?.id,ids[0]);
 assert.equal(penalized.at(-1)?.rank,12);
 }
});
test('Double Winner orders tied IDs numerically inside each group',()=>{
 const e=createEvent({name:'Double ties',kind:'pairs',rankingMode:'double',names:Array.from({length:24},(_,i)=>String(24-i)),date:'2026-10-20',venue:''});
 const ids=e.participants.map(p=>p.id);e.participants.reverse();
 const rows=project(e).standings;
 assert.deepEqual(rows.map(p=>p.id),ids);
 assert.ok(rows.every(p=>p.rank===1));
 assert.deepEqual(rows.slice(0,12).map(p=>p.group),Array(12).fill('NS'));
});
