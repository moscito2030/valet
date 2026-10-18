import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import howells from '../lib/acbl-howell-records.json';
import rovers from '../lib/acbl-rover-records.json';
import externalMovements from '../lib/acbl-movements.json';
import { decodeAcblHowell } from '../lib/acbl-howell';
import { decodeAcblRover } from '../lib/acbl-rover';
import { buildAcblWeb } from '../lib/acbl-web';
import { buildAcblAppendix } from '../lib/acbl-appendix';
import { parseAcblMovement, type AcblMovement } from '../lib/acbl-movement';
import { buildMovement } from '../lib/movement-plans';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';
import { randomUUID, createHash } from 'node:crypto';
import hashes from './fixtures/acbl833/reference-hashes.json';
import { exportMovement, parseMovement } from '../lib/imports';

function check(m: AcblMovement) {
  const boards = new Set<string>();
  for (const [round, row] of m.rows.entries()) {
    const pairs = new Set<number>();
    for (const cell of row) {
      if (!cell) continue;
      for (const pair of cell.slice(0, 2)) {
        assert.ok(pair >= 1 && pair <= m.pairCount, `${m.name}: pair ${pair}`);
        assert.ok(!pairs.has(pair), `${m.name}: duplicate seat, round ${round + 1}`);
        pairs.add(pair);
        const key = `${pair}:${cell[2]}`;
        assert.ok(!boards.has(key), `${m.name}: replay ${key}`);
        boards.add(key);
      }
    }
    assert.equal(pairs.size, Math.floor(m.pairCount / 2) * 2, m.name);
  }
}

test('independent movement fixtures retain their pinned content hashes', () => {
  for (const [file, hash] of Object.entries(hashes)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(new URL(`./fixtures/acbl833/${file}`, import.meta.url)))
        .digest('hex'),
      hash,
      file,
    );
  }
});

test('102 internal Howell records have valid seats and board routes, including both combined cycles', () => {
  assert.equal(howells.length, 102);
  for (const record of howells) {
    const m = decodeAcblHowell(record.name, record.text);
    check(m);
    const event = createEvent({
      name: m.name,
      kind: 'pairs',
      rankingMode: 'single',
      date: '2026-10-19',
      venue: '',
      names: Array.from({ length: m.pairCount }, (_, i) => `P${i + 1}`),
    });
    const plan = buildMovement({ ...event, rounds: m.rounds, boardsPerRound: 2 }, `acbl-${m.name}`);
    const scheduled = applyMutation(
      { event, projection: project(event), requests: [] },
      {
        action: 'movement-plan',
        plan: `acbl-${m.name}`,
        rounds: m.rounds,
        boardsPerRound: 2,
        revision: 1,
        requestId: randomUUID(),
        reason: '驗證官方編排',
      },
    ).event;
    assert.equal(
      parseMovement(exportMovement(scheduled), scheduled).length,
      plan.assignments.length,
    );
  }
});

test('eight independent ACBLscore Howell exports match every seat and board group', () => {
  for (const name of ['H0203', 'H0305', 'H0406', 'H0508', 'H0608', 'H0708', 'H0712', 'H0812']) {
    const record = howells.find((r) => r.name === `${name}.HOW`)!;
    const expected = parseAcblMovement(
      readFileSync(new URL(`./fixtures/acbl833/howell/${name}.MOV`, import.meta.url)),
    );
    assert.deepEqual(decodeAcblHowell(record.name, record.text).rows, expected.rows, name);
  }
});

test('every Rover record supports both directions without duplicate seats or boards', () => {
  for (const record of rovers)
    for (const side of ['NS', 'EW'] as const) {
      const name = side === 'EW' ? `EW-${record.name}` : record.name;
      const m = decodeAcblRover(name, record.text, side);
      check(m);
      const event = createEvent({
        name,
        kind: 'pairs',
        rankingMode: 'single',
        date: '2026-10-19',
        venue: '',
        names: Array.from({ length: m.pairCount }, (_, i) => `P${i + 1}`),
      });
      const scheduled = applyMutation(
        { event, projection: project(event), requests: [] },
        {
          action: 'movement-plan',
          plan: `double-acbl-${name}`,
          rounds: m.rounds,
          boardsPerRound: 2,
          revision: 1,
          requestId: randomUUID(),
          reason: '驗證輪休編排',
        },
      ).event;
      assert.equal(scheduled.participants.filter((p) => p.group === 'NS').length, m.nsCount);
      assert.equal(parseMovement(exportMovement(scheduled), scheduled).length, m.rounds * m.tables);
    }
  const record = rovers.find((r) => r.name === 'R0909.ROV')!;
  const m = decodeAcblRover(record.name, record.text);
  // Published special route: EW 6 and 9 exchange on rounds 3, 6 and 9.
  assert.equal(m.rows[2][7]![1], 19);
  assert.equal(m.rows[2][1]![1], 16);
  assert.equal(m.rows[1][1]![0], 10);
});

test('Web works through 40 tables and matches Tim Hill’s 18-table 13-round worked example', () => {
  for (let tables = 4; tables <= 40; tables += 2)
    for (let rounds = 3; rounds < tables; rounds += 2) check(buildAcblWeb(tables, rounds));
  for (const tables of [28, 30, 32, 34, 36]) {
    assert.deepEqual(
      buildAcblWeb(tables, 13).rows,
      externalMovements.find((m) => m.name === `W${tables}13.mov`)!.rows,
    );
  }
  const m = buildAcblWeb(18, 13);
  assert.deepEqual(
    m.rows[0].map((c) => c![2]),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1, 13],
  );
  assert.deepEqual(m.rows[12][17], [18, 24, 1]);
});

test('Appendix matches independent odd/even round exports and remains valid through 79 pairs', () => {
  for (let tables = 4; tables <= 39; tables++) check(buildAcblAppendix(tables));
  for (const [name, tables] of [
    ['AM090824', 9],
    ['AM100927', 10],
  ] as const) {
    const expected = parseAcblMovement(
      readFileSync(new URL(`./fixtures/acbl833/${name}.MOV`, import.meta.url)),
    );
    assert.deepEqual(
      buildAcblAppendix(tables).rows,
      expected.rows.map((row) => row.filter(Boolean)),
    );
  }
});

test('custom pair order, arbitrary phantom, shortened schedules and Barometer compose safely', () => {
  const event = createEvent({
    name: 'Options',
    kind: 'pairs',
    rankingMode: 'single',
    date: '2026-10-19',
    venue: '',
    names: ['A', 'B', 'C', 'D', 'E'],
  });
  const draft = { ...event, rounds: 3, boardsPerRound: 2 };
  const plan = buildMovement(draft, 'acbl-H0305.HOW', undefined, undefined, undefined, {
    phantom: 2,
    pairOrder: ['p5', 'p4', 'p3', 'p2', 'p1'],
    barometer: true,
  });
  assert.equal(plan.boardCount, 6);
  assert.equal(plan.assignments.length, 6);
  assert.ok(plan.assignments.every((a) => a.boards[0] === a.round * 2 - 1));
  assert.ok(!plan.assignments.some((a) => a.round === 3 && (a.ns === 'p3' || a.ew === 'p3')));
  assert.throws(
    () =>
      buildMovement(draft, 'acbl-H0305.HOW', undefined, undefined, undefined, {
        pairOrder: ['p1', 'p1', 'p3', 'p4', 'p5'],
      }),
    /不得重複/,
  );
  assert.throws(
    () => buildMovement(draft, 'acbl-H0305.HOW', undefined, undefined, undefined, { phantom: 7 }),
    /輪空/,
  );
  const mapped = buildMovement(draft, 'acbl-H0305.HOW', undefined, undefined, undefined, {
    groupOrder: [5, 4, 3, 2, 1],
  });
  assert.deepEqual(mapped.assignments[0].boards, [7, 8]);
  assert.throws(
    () =>
      buildMovement(draft, 'acbl-H0305.HOW', undefined, undefined, undefined, {
        groupOrder: [1, 1, 2, 3, 4],
      }),
    /牌組對照/,
  );
});
