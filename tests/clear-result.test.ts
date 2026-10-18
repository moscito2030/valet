import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { mutationSchema, type Mutation, type StoredEvent } from '../lib/model';
import { clubAccepted, clubConfirmationKey, clubReviewVersion } from '../lib/club-confirmation';
import { canMutate } from '../lib/mutation-permissions';

for (const kind of ['pairs', 'teams'] as const) for (const mode of ['pair', 'table'] as const) {
  if (kind === 'teams' && mode === 'pair') continue;
  test(`clear one result in ${kind}/${mode} invalidates only its table and preserves audit`, () => {
    const event = createEvent({name:'Clear',kind,gameMode:'minibridge',names:['A','B','C','D'],rounds:1,boardsPerRound:2,date:'2026-10-19',venue:''});
    let state: StoredEvent = {event,projection:project(event),requests:[]};
    const run = (payload: object): StoredEvent => state = applyMutation(state, mutationSchema.parse({...payload, revision:state.event.revision,requestId:randomUUID(),reason:'test clear'}));
    run({action:'club-config',enabled:true,mode});
    const a = event.assignments[0], board = a.boards[0], key = `${a.id}:${board}`;
    const rows = event.assignments.flatMap(a => a.boards.map(board => ({assignmentId:a.id,board,level:1,strain:'H',declarer:'N',doubled:1,tricks:8,lead:'SA',hcp:{N:12}})));
    run({action:'results',results:rows});
    for (const assignment of event.assignments) state.event.club!.confirmations[clubConfirmationKey(state.event,assignment)] = {forced:false,reviewVersion:clubReviewVersion(state.event,assignment),at:new Date().toISOString()};
    assert.ok(clubAccepted(state.event,a));
    const before = structuredClone(state.event.results);
    const command = mutationSchema.parse({action:'clear-result',assignmentId:a.id,board,revision:state.event.revision,requestId:randomUUID()});
    assert.ok(canMutate('admin',command)); assert.ok(canMutate('director',command)); assert.equal(canMutate(null,command),false);
    state = applyMutation(state,command);
    assert.equal(state.event.results[key],undefined);
    assert.equal(clubAccepted(state.event,a),false);
    for (const [k,v] of Object.entries(before)) if(k!==key) assert.deepEqual(state.event.results[k],v);
    for (const other of event.assignments.filter(x=>x.id!==a.id)) assert.ok(clubAccepted(state.event,other));
    assert.deepEqual(state.event.audit.at(-1)?.changes,[{key,before:before[key],after:null}]);
    assert.deepEqual(state.projection,project(state.event));
    assert.equal(applyMutation(state,command),state);
    assert.throws(()=>run({action:'clear-result',assignmentId:a.id,board}),/尚未收分/);
    run({action:'results',results:[rows[0]]});
    assert.equal(clubAccepted(state.event,a),false);
    state.event.club!.finalized=[a.round];
    assert.throws(()=>run({action:'clear-result',assignmentId:a.id,board}),/本圈已結算/);
    state.event.club!.finalized=[];
    state.event.status='finished';
    assert.throws(()=>run({action:'clear-result',assignmentId:a.id,board}),/重新開放賽事/);
    state.event.status='live';
    assert.throws(()=>run({action:'clear-result',assignmentId:a.id,board:9999}),/不符合賽程/);
    assert.throws(()=>applyMutation(state,{...command,requestId:randomUUID()}),/其他操作更新/);
    if (kind === 'teams') {
      run({action:'split-contract',assignmentId:a.id,board,contracts:{ns:rows[0],ew:rows[0]}});
      assert.throws(()=>run({action:'clear-result',assignmentId:a.id,board}),/撤銷不平衡合約/);
      run({action:'split-contract',assignmentId:a.id,board,contracts:null});
    }
    run({action:'ruling',assignmentId:a.id,board,cancelled:true});
    run({action:'clear-result',assignmentId:a.id,board});
    assert.equal(state.event.results[key],undefined);
  });
}
