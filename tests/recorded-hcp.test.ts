import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { recordedHcpSchema, hcpDeclarer } from '../lib/recorded-hcp';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { resultSchema } from '../lib/model';
import { exportResultsCsv, parseResultsCsv } from '../lib/imports';
import { audienceEvent, clubView } from '../lib/club-view';
import { clubReviewVersion } from '../lib/club-confirmation';

test('optional HCP validates blanks, zero, bounds and totals; declarer respects dealer order', () => {
  for (const h of [{},{N:0},{N:37,S:3},{N:12,E:8,S:13,W:7}]) assert.ok(recordedHcpSchema.safeParse(h).success);
  for (const h of [{N:-1},{N:38},{N:1.5},{N:30,S:11},{N:0,E:0,S:0,W:0},{X:10}]) assert.ok(!recordedHcpSchema.safeParse(h).success);
  assert.equal(hcpDeclarer({N:12,E:8,S:13,W:7},'N'),'S');
  assert.equal(hcpDeclarer({N:12,E:8,S:12,W:8},'S'),'S');
  assert.equal(hcpDeclarer({N:10,E:10,S:10,W:10},'N'),null);
  assert.equal(hcpDeclarer({N:12},'N'),undefined);
});
test('HCP persists per result, roundtrips CSV, invalidates confirmation and stays private before publication', () => {
  const event=createEvent({name:'HCP test',kind:'pairs',gameMode:'minibridge',names:['A','B','C','D'],rounds:1,boardsPerRound:2,date:'2026-10-18',venue:''});
  const a=event.assignments[0];
  const result=resultSchema.parse({assignmentId:a.id,board:1,level:1,strain:'NT',doubled:1,declarer:'N',tricks:7,lead:'',hcp:{N:0,E:13,S:15,W:12}});
  const state=applyMutation({event,projection:project(event),requests:[]},{action:'results',results:[result],revision:event.revision,requestId:randomUUID(),reason:'Record HCP'});
  const e=state.event;
  assert.deepEqual(parseResultsCsv(exportResultsCsv(e))[0].hcp,result.hcp);
  e.club={enabled:true,tokens:{},confirmations:{},finalized:[]};
  e.currentRound=1;
  assert.deepEqual(clubView(e,a.ns).boards[0].result?.hcp,result.hcp);
  const version=clubReviewVersion(e,a);
  const r=Object.values(e.results)[0];
  r.hcp={N:1,E:12,S:15,W:12};
  assert.notEqual(clubReviewVersion(e,a),version);
  assert.deepEqual(audienceEvent(e).results,{});
  e.club.finalized=[1];
  assert.deepEqual(Object.values(audienceEvent(e).results)[0].hcp,r.hcp);
  assert.throws(()=>parseResultsCsv('assignmentId,board,level,strain,doubled,declarer,tricks,hcpN,hcpE,hcpS,hcpW\na,1,1,NT,1,N,7,1,1,1,1'));
});
