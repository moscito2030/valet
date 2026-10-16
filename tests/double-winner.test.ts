import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project, imps } from '../lib/scoring';
import { exportMovement, parseMovement } from '../lib/imports';
import { audienceEvent, clubView } from '../lib/club-view';
import { movementOptions, buildMovement } from '../lib/movement-plans';
import type { Mutation, StoredEvent } from '../lib/model';

function make(tables: number, relay = tables % 2 === 0) {
  return createEvent({ name: 'Double Winner', kind: 'pairs', gameMode: 'minibridge', pairMethod: 'crossimp', trim: 'none',
    movementPlan: relay ? 'double-mitchell-relay' : 'double-mitchell',
    names: Array.from({ length: tables * 2 }, (_, i) => `Pair ${i + 1}`),
    rounds: relay || tables % 2 ? tables : tables - 1, boardsPerRound: 1, date: '2026-10-17', venue: '' });
}

test('3–19 table double Mitchell variants keep groups fixed, opponents unique and boards unrepeated', () => {
  for (let tables = 3; tables <= 19; tables++) {
    for (const relay of tables % 2 ? [false] : [false, true]) {
      const e = make(tables, relay);
      assert.equal(e.participants.filter(p => p.group === 'NS').length, tables);
      assert.equal(e.participants.filter(p => p.group === 'EW').length, tables);
      assert.equal(e.boards.length, tables);
      assert.equal(parseMovement(exportMovement(e), e).length, tables * e.rounds);
      const opponents = new Set<string>();
      for (const a of e.assignments) {
        assert.equal(e.participants.find(p => p.id === a.ns)?.group, 'NS');
        assert.equal(e.participants.find(p => p.id === a.ew)?.group, 'EW');
        assert.ok(!opponents.has(`${a.ns}:${a.ew}`));
        opponents.add(`${a.ns}:${a.ew}`);
      }
      assert.ok(e.boards.every(b => b.vulnerability === 'None'));
    }
  }
});

test('double winner rejects invalid sizes, rounds, board limits and direction-changing imports', () => {
  assert.throws(() => make(2));
  assert.throws(() => make(20));
  const e = make(4);
  assert.ok(!movementOptions({ ...e, rounds: 4 }).some(p => p.id === 'double-mitchell'));
  assert.ok(movementOptions({ ...e, boardsPerRound: 17 }).some(p => p.id.startsWith('double-')));
  assert.throws(() => buildMovement({ ...e, boardsPerRound: 17 }, 'double-mitchell-relay'), /1–16/);
  const reversed = { ...e, assignments: e.assignments.map(a => ({ ...a, ns: a.ew, ew: a.ns })) };
  assert.throws(() => parseMovement(exportMovement(reversed), e), /分組/);
});

test('3 and 4 table MiniBridge club matches finalize and rank CrossIMP independently in each group', () => {
  for (const tables of [3, 4]) {
    let state: StoredEvent = { event: make(tables), projection: project(make(tables)), requests: [] };
    const apply = (payload: Record<string, unknown>) => {
      state = applyMutation(state, { ...payload, revision: state.event.revision, requestId: randomUUID(), reason: 'Double Winner verification' } as Mutation);
    };
    apply({ action: 'club-config', enabled: true });
    state.event.participants.forEach((p, i) => apply({ action: 'club-config', enabled: true, participantId: p.id, tokenHash: (i + 1).toString(16).padStart(64, '0') }));
    for (let round = 1; round <= state.event.rounds; round++) {
      apply({ action: 'round-control', round, phase: 'playing' });
      for (const a of state.event.assignments.filter(a => a.round === round)) {
        const board = a.boards[0];
        apply({ action: 'club-play', round, confirm: false, tokenHash: state.event.club!.tokens[a.ns],
          result: { assignmentId: a.id, board, level: 1, strain: 'NT', declarer: 'N', doubled: 1, tricks: 6 + Number(a.table), lead: '' } });
        apply({ action: 'club-play', round, confirm: true, tokenHash: state.event.club!.tokens[a.ew], reviewVersion: clubView(state.event, a.ew).reviewVersion });
      }
      apply({ action: 'club-finalize', round, force: false });
    }
    const expected = new Map(state.event.participants.map(p => [p.id, 0]));
    for (const board of state.event.boards) {
      const rows = state.event.assignments.filter(a => a.boards.includes(board.number));
      for (const a of rows) {
        const raw = state.event.results[`${a.id}:${board.number}`].nsScore;
        const cross = rows.filter(b => b.id !== a.id).reduce((sum, b) => sum + imps(raw - state.event.results[`${b.id}:${board.number}`].nsScore), 0) / (rows.length - 1);
        expected.set(a.ns, expected.get(a.ns)! + cross);
        expected.set(a.ew, expected.get(a.ew)! - cross);
      }
    }
    const publicEvent = audienceEvent(state.event);
    assert.ok(publicEvent.participants.every(p => p.group));
    for (const group of ['NS', 'EW']) {
      const rows = publicEvent.projection.standings.filter(s => s.group === group);
      assert.equal(rows.length, tables);
      assert.equal(rows[0].rank, 1);
      rows.forEach((row, i) => {
        assert.ok(Math.abs(row.score! - expected.get(row.id)!) < 1e-8);
        assert.equal(row.rank, 1 + rows.filter(other => other.score! > row.score! + 1e-8).length);
        if (i) assert.ok(rows[i - 1].score! >= row.score! - 1e-8);
      });
    }
    assert.throws(() => apply({ action: 'movement-plan', plan: 'barometer' }), /尚未收分/);
  }
});

test('applying and leaving double winner updates groups atomically before scoring', () => {
  const e = make(3);
  let state: StoredEvent = { event: e, projection: project(e), requests: [] };
  for (const plan of ['barometer', 'double-mitchell']) {
    state = applyMutation(state, { action: 'movement-plan', plan, revision: state.event.revision, requestId: randomUUID(), reason: 'Change movement' });
    assert.equal(state.event.participants.every(p => !!p.group), plan === 'double-mitchell');
  }
});
