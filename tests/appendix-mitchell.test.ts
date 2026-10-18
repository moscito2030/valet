import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPENDIX_BASES,
  buildAppendixMitchell,
  isInterwovenRecord,
  sessionsHaveDistinctOpponents,
} from '../lib/appendix-mitchell';
import { decodeAcblHowell } from '../lib/acbl-howell';
import records from '../lib/acbl-howell-records.json';
import { buildMovement, movementOptions } from '../lib/movement-plans';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { randomUUID } from 'node:crypto';
const event = (tables: number, rounds: number) =>
  createEvent({
    kind: 'pairs',
    name: 'Appendix',
    date: '2026-10-19',
    venue: '',
    rounds,
    boardsPerRound: 2,
    names: Array.from({ length: 2 * tables }, (_, i) => 'Pair ' + (i + 1)),
  });
test('every Appendix has complete rounds, unique opponents and every pair plays each board group once', () => {
  for (const r of APPENDIX_BASES)
    for (let t = r + 1; t <= Math.min(2 * r, 40); t++) {
      const m = buildAppendixMitchell(t, r),
        pairs = new Map<number, Set<number>>(),
        opponents = new Set<string>();
      for (const row of m.rows) {
        const seated = new Set<number>();
        const copies = new Map<number, number>();
        for (const c of row) {
          assert.ok(c);
          const [a, b, g] = c;
          assert.ok(a >= 1 && a <= t && b > t && b <= 2 * t);
          assert.ok(!seated.has(a) && !seated.has(b));
          seated.add(a);
          seated.add(b);
          const key = [a, b].sort((a, b) => a - b).join(':');
          assert.ok(!opponents.has(key), `${t}/${r}: ${key}`);
          opponents.add(key);
          for (const p of [a, b]) {
            const seen = pairs.get(p) ?? new Set();
            assert.ok(!seen.has(g), `${t}/${r}: pair ${p}, group ${g}`);
            seen.add(g);
            pairs.set(p, seen);
          }
          copies.set(g, (copies.get(g) ?? 0) + 1);
        }
        assert.equal(seated.size, 2 * t);
        assert.ok([...copies.values()].every((n) => n <= 2));
      }
      assert.ok([...pairs.values()].every((groups) => groups.size === r));
    }
});
test('full 15-table and 16-table 13-round sessions connect to corresponding IWH without rematches', () => {
  for (const tables of [15, 16]) {
    const a = buildAppendixMitchell(tables, 13),
      record = records.find((r) => r.name === `H${tables}13.HOW`)!;
    assert.ok(isInterwovenRecord(record.text));
    const h = decodeAcblHowell(record.name, record.text);
    assert.ok(sessionsHaveDistinctOpponents(a, h));
    const opts = movementOptions(event(tables, 13));
    assert.match(
      opts.find((o) => o.id === `acbl-${a.name}`)!.sessionNote!,
      new RegExp(record.name),
    );
    const second = opts.find((o) => o.id === `acbl-${record.name}`)!;
    assert.match(second.label, /Interwoven Howell/);
    assert.match(second.sessionNote!, new RegExp(`${tables} 桌 13 圈`));
  }
});
test('Appendix applies through existing mutation and honors pair order and fresh board group settings', () => {
  const e = event(15, 13),
    id = 'acbl-APPENDIX-T15-R13';
  const order = e.participants.map((p) => p.id).reverse();
  const plan = buildMovement(e, id, undefined, undefined, undefined, { pairOrder: order });
  assert.equal(plan.assignments.length, 15 * 13);
  assert.equal(plan.boardCount, 26);
  assert.equal(plan.copies, 2);
  const saved = applyMutation(
    { event: e, projection: project(e), requests: [] },
    {
      action: 'movement-plan',
      plan: id,
      revision: e.revision,
      requestId: randomUUID(),
      reason: 'Appendix test',
      pairMovement: { pairOrder: order },
    },
  );
  assert.deepEqual(saved.event.assignments, plan.assignments);
  assert.throws(() => buildAppendixMitchell(14, 9));
  assert.throws(() => buildAppendixMitchell(13, 13));
  assert.throws(() => buildAppendixMitchell(41, 37));
  assert.ok(
    !movementOptions({ ...e, participants: e.participants.slice(1) }).some((o) => o.id === id),
  );
  assert.ok(!movementOptions({ ...e, rounds: 12 }).some((o) => o.id === id));
});
test('1.5-table Appendix remains separate; ordinary Howells are not advertised as interwoven', () => {
  assert.match(
    movementOptions({ ...event(10, 8), participants: event(10, 8).participants.slice(1) }).find(
      (o) => o.id === 'acbl-APPENDIX9',
    )!.label,
    /1½-table/,
  );
  assert.ok(!movementOptions(event(4, 7)).find((o) => o.id === 'acbl-H0407.HOW')!.sessionNote);
});

test('Appendix supports single-winner arrow switching and double-winner fixed groups', () => {
  const e = event(15, 13),
    id = 'acbl-APPENDIX-T15-R13';
  const fixed = buildMovement(e, 'double-' + id);
  assert.equal(fixed.participants.filter((p) => p.group === 'NS').length, 15);
  const switched = buildMovement(e, id);
  const unchanged = buildMovement(e, id, undefined, 0);
  switched.assignments.forEach((a, i) => {
    const b = fixed.assignments[i];
    assert.equal(a.ns, a.round >= 7 ? b.ew : b.ns);
    assert.equal(a.ew, a.round >= 7 ? b.ns : b.ew);
    assert.deepEqual(a.boards, b.boards);
    assert.equal(unchanged.assignments[i].ns, b.ns);
  });
});

test('IWH gives verified ordinary Mitchell first-session round counts, including odd-table omitted round', () => {
  for (const tables of [7, 9, 11, 13, 15, 17]) {
    const e = event(tables, tables);
    const record = records.find(
      (r) => r.name === `H${String(tables).padStart(2, '0')}${String(tables).padStart(2, '0')}.HOW`,
    )!;
    const option = movementOptions(e).find((o) => o.id === `acbl-${record.name}`)!;
    assert.match(
      option.sessionNote!,
      new RegExp(`單套牌 Mitchell（${tables} 桌 ${tables - 1} 圈）`),
    );
    const first = buildMovement({ ...e, rounds: tables - 1 }, 'mitchell');
    const second = buildMovement(e, option.id);
    const opponents = new Set(first.assignments.map((a) => [a.ns, a.ew].sort().join(':')));
    assert.ok(second.assignments.every((a) => !opponents.has([a.ns, a.ew].sort().join(':'))));
  }
});
