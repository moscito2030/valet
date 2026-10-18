import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import catalog from '../lib/acbl-movements.json';
import { parseAcblMovement } from '../lib/acbl-movement';
import { buildMovement, movementOptions } from '../lib/movement-plans';
import { createEvent, applyMutation } from '../lib/events';
import { parseMovement, exportMovement } from '../lib/imports';
import { project } from '../lib/scoring';
import { clubView } from '../lib/club-view';

test('official binary fixtures match pinned hashes, pair direction mappings and table records', () => {
  for (const name of ['H0206.MOV','H0310.MOV','WBMP1613.MOV']) {
    const bytes=readFileSync(new URL(`./fixtures/acbl833/${name}`,import.meta.url));
    const {sha256,...expected}=catalog.find(m=>m.name===name)!;
    assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256);
    assert.deepEqual(parseAcblMovement(bytes,name),expected);
  }
  const compact=parseAcblMovement(readFileSync(new URL('./fixtures/acbl833/H0206.MOV',import.meta.url)));
  assert.deepEqual(compact.rows[0],[[1,2,1],[3,4,2]]);
  assert.deepEqual(compact.rows[5],[[3,2,5],[4,1,6]]);
  const rover=parseAcblMovement(readFileSync(new URL('./fixtures/acbl833/WBMP1613.MOV',import.meta.url)));
  assert.equal(rover.nsCount,17);
  assert.equal(rover.pairCount,33);
  assert.deepEqual(rover.rows[1][1],[17,18,3]);
});

test('all 75 ACBLscore 8.33 external pair schedules apply and round-trip through CSV', () => {
  assert.equal(catalog.length, 75);
  for (const entry of catalog) {
    const event = createEvent({ name: entry.name, kind: 'pairs', date: '2026-10-19', venue: '',
      rankingMode: 'single', names: Array.from({length: entry.pairCount}, (_, i) => `搭檔 ${i + 1}`) });
    for (const prefix of entry.oneWinner ? [''] : ['', 'double-']) {
      const stored = { event: structuredClone(event), projection: project(event), requests: [] };
      const updated = applyMutation(stored, { action: 'movement-plan', plan: `${prefix}acbl-${entry.name}`,
        rounds: entry.rounds, boardsPerRound: 2, revision: 1, requestId: randomUUID(), reason: 'Verify official schedule' });
      const actual = updated.event;
      assert.equal(actual.assignments.length, entry.rounds * Math.floor(entry.pairCount / 2), entry.name);
      assert.equal(parseMovement(exportMovement(actual), actual).length, actual.assignments.length);
      for (const a of actual.assignments) {
        const expected = entry.rows[a.round - 1][Number(a.table) - 1]!;
        assert.equal(a.ns, `p${expected[0]}`);
        assert.equal(a.ew, `p${expected[1]}`);
        assert.deepEqual(a.boards, [expected[2] * 2 - 1, expected[2] * 2]);
      }
      if (prefix) assert.equal(actual.participants.filter(p => p.group === 'NS').length, entry.nsCount);
      assert.equal(actual.currentRound, 0);
    }
  }
});

function fixture(padded = false) {
  const stride = padded ? 25 : 3;
  const b = new Uint8Array(707 + 2 * stride * 3);
  b.set(padded ? [0x6d, 0xb4, 1, 2, 3, 3] : [0x5d, 0x8d, 1, 2, 3, 3]);
  const rounds = [[[1,2,1],[3,4,1]],[[1,3,2],[2,4,2]],[[1,4,3],[2,3,3]]];
  rounds.forEach((row,r) => row.forEach((cell,t) => b.set(cell,707+(t*stride+r)*3)));
  return b;
}

test('MOV decoder handles compact and padded records without treating padding as live tables', () => {
  assert.deepEqual(parseAcblMovement(fixture()), parseAcblMovement(fixture(true)));
  const movement = parseAcblMovement(fixture());
  assert.equal(movement.pairCount, 4);
  assert.deepEqual(movement.rows[2], [[1,4,3],[2,3,3]]);
});

test('MOV decoder rejects damaged files, duplicate seats and boards, and unsupported mapping flags', () => {
  assert.throws(() => parseAcblMovement(fixture().slice(0,-1)), /不完整/);
  for (const [offset,value,pattern] of [
    [0,0,/MOV/], [3,41,/桌數/], [606,1,/重新編號/], [671,2,/牌組對照/],
    [716,1,/重複出場/], [712,1,/重複打/], [709,0,/資料不正確/],
  ] as const) {
    const bytes = fixture(); bytes[offset] = value;
    assert.throws(() => parseAcblMovement(bytes), pattern);
  }
});

test('official options reject excess rounds and cannot be used for teams', () => {
  const event = {kind: 'pairs' as const, rounds: 12, boardsPerRound: 2,
    participants: Array.from({length: 13}, (_,i) => ({id:`p${i+1}`,name:`P${i+1}`,players:''}))};
  const id = 'acbl-H7ROVER.MOV';
  assert.ok(movementOptions(event).some(p => p.id === id));
  const plan = buildMovement(event,id);
  assert.equal(plan.assignments.length,72);
  assert.ok(plan.assignments.every(a => a.ns !== 'p14' && a.ew !== 'p14'));
  assert.throws(() => buildMovement({...event,rounds:13},id), /不適用/);
  assert.throws(() => buildMovement({...event,kind:'teams'},id), /不適用/);
});

test('uploaded MOV is validated by the mutation and cannot replace scored schedules', () => {
  const event = createEvent({name:'Import',kind:'pairs',date:'2026-10-19',venue:'',rankingMode:'single',names:['A','B','C','D']});
  const original = {event, projection: project(event),requests:[]};
  const command = {action:'movement-plan' as const,plan:'acbl-uploaded.MOV',movementFile:Array.from(fixture()),
    rounds:3,boardsPerRound:2,revision:1,requestId:randomUUID(),reason:'匯入驗證'};
  const state = applyMutation(original,command);
  assert.equal(state.event.assignments.length,6);
  assert.equal(original.event.assignments.length,0);
  assert.throws(() => applyMutation(original,{...command,movementFile:[1,2,3]}),/長度/);
  assert.throws(() => applyMutation(original,{...command,plan:'mitchell'}),/不符/);
  assert.throws(() => applyMutation(original,{...command,rounds:4}),/不適用/);
  const a=state.event.assignments[0];
  state.event.results[`${a.id}:1`]={assignmentId:a.id,board:1,level:1,strain:'NT',declarer:'N',doubled:1,tricks:7,lead:'',nsScore:90,status:'played',updatedAt:''};
  assert.throws(() => applyMutation(state,{...command,revision:state.event.revision,requestId:randomUUID()}),/尚未收分/);
});

test('Rover guide cards describe the real next table or bye at every half-round boundary', () => {
  const event = createEvent({name:'Rover guide',kind:'pairs',date:'2026-10-19',venue:'',rankingMode:'single',
    names:Array.from({length:13},(_,i)=>`P${i+1}`)});
  const state=applyMutation({event,projection:project(event),requests:[]}, {action:'movement-plan',plan:'acbl-H7ROVER.MOV',
    rounds:12,boardsPerRound:2,revision:1,requestId:randomUUID(),reason:'Guide card test'});
  state.event.club={enabled:true,tokens:{},confirmations:{},finalized:[]};
  state.event.roundPhase='break';
  for(let round=1;round<12;round++) {
    state.event.currentRound=round;
    for(const pair of state.event.participants) {
      const guide=clubView(state.event,pair.id).guide;
      const next=state.event.assignments.find(a=>a.round===round+1&&(a.ns===pair.id||a.ew===pair.id));
      if(next) {
        assert.equal(guide?.kind,'table');
        if(guide?.kind==='table') { assert.equal(guide.table,next.table);assert.deepEqual(guide.boards,next.boards); }
      } else assert.equal(guide?.kind,'bye');
    }
  }
});
