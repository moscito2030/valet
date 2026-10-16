import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyMutation, createEvent } from '../lib/events';
import { buildMovement, movementOptions } from '../lib/movement-plans';
import { project, teamStandingsThroughRound, vp } from '../lib/scoring';
import { exportMovement, parseMovement, parseByeVp } from '../lib/imports';
import {
  mutationSchema,
  resultKey,
  type BridgeEvent,
  type Result,
  type StoredEvent,
} from '../lib/model';
import {
  teamByes,
  validateInterleavedLineups,
  defaultInterleavedGroups,
  roundLabel,
  interleavedSize,
} from '../lib/team-movement';
import { teamButlerStats } from '../lib/team-butler';
import { audienceEvent } from '../lib/club-view';
import { allRoundsComplete } from '../lib/round-progress';

const fixture = (n: number, rounds = n, boardsPerRound = 2) =>
  createEvent({
    name: '奇數隊測試',
    kind: 'teams',
    names: Array.from({ length: n }, (_, i) => `Team ${i + 1}`),
    rounds,
    boardsPerRound,
    date: '2026-10-17',
    venue: '',
  });
const store = (event: BridgeEvent): StoredEvent => ({
  event,
  projection: project(event),
  requests: [],
});
const apply = (s: StoredEvent, payload: object) =>
  applyMutation(
    s,
    mutationSchema.parse({
      ...payload,
      revision: s.event.revision,
      requestId: randomUUID(),
      reason: '驗證奇數隊編排',
    }),
  );
const cycle = (n: number) =>
  apply(store(fixture(n, n - 1)), { action: 'movement-plan', plan: 'team-interleaved' }).event;
function score(event: BridgeEvent, through = event.rounds) {
  for (const a of event.assignments.filter((a) => a.round <= through))
    for (const board of a.boards) {
      event.results[resultKey(a.id, board)] = {
        assignmentId: a.id,
        board,
        level: 0,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 0,
        lead: '',
        nsScore: 0,
        updatedAt: '',
      };
    }
}

test('every odd team size 3–31 has one bye per round, one bye per team, and all opponents once', () => {
  for (let n = 3; n <= 31; n += 2) {
    const event = fixture(n);
    for (const assignments of [
      event.assignments,
      buildMovement(event, 'team-round-robin').assignments,
    ]) {
      const e = { ...event, assignments };
      const byes = teamByes(e);
      assert.equal(byes.length, n);
      assert.equal(new Set(byes.map((b) => b.participantId)).size, n);
      assert.ok(byes.every((b) => b.vp === 12));
      assert.equal(assignments.length, n * (n - 1));
      assert.equal(
        new Set(assignments.filter((a) => a.room === 'open').map((a) => [a.ns, a.ew].sort().join()))
          .size,
        (n * (n - 1)) / 2,
      );
      assert.equal(parseMovement(exportMovement(e), e).length, assignments.length);
      for (let r = 1; r <= n; r++) {
        const open = assignments.filter((a) => a.round === r && a.room === 'open');
        assert.equal(new Set(open.flatMap((a) => [a.ns, a.ew])).size, n - 1);
      }
    }
  }
  assert.throws(() => fixture(2));
  assert.throws(() => fixture(33));
  assert.throws(() => fixture(31, 31, 5), /128/);
});

for (const n of [3, 5])
  test(`${n}-team interleaved movement: every pair plays continuously, no repeats, reciprocal matches, CSV round trip`, () => {
    const event = cycle(n);
    assert.equal(event.teamMovement, 'interleaved');
    assert.equal(event.assignments.length, n * (n - 1));
    assert.equal(event.boards.length, n * 2);
    assert.deepEqual(teamByes(event), []);
    assert.deepEqual(parseMovement(exportMovement(event), event), event.assignments);
    for (const team of event.participants)
      for (const side of ['ns', 'ew'] as const) {
        const rows = event.assignments.filter((a) => a[side] === team.id);
        assert.equal(rows.length, n - 1);
        assert.equal(new Set(rows.map((a) => a.round)).size, n - 1);
        assert.equal(new Set(rows.flatMap((a) => a.boards)).size, (n - 1) * 2);
        assert.equal(new Set(rows.map((a) => a[side === 'ns' ? 'ew' : 'ns'])).size, n - 1);
        if (side === 'ns') assert.equal(new Set(rows.map((a) => a.table)).size, 1);
      }
    for (let r = 1; r < n; r++) {
      const rows = event.assignments.filter((a) => a.round === r);
      assert.equal(new Set(rows.map((a) => a.table)).size, n);
      assert.equal(new Set(rows.flatMap((a) => a.boards)).size, n * 2);
    }
    const projection = project(event);
    assert.equal(projection.matches.length, (n * (n - 1)) / 2);
    assert.ok(projection.matches.every((m) => m.round % 2 === 0 && m.vpA === null));
    score(event, 1);
    assert.ok(project(event).matches.every((m) => m.vpA === null));
    score(event, 2);
    assert.equal(project(event).matches.filter((m) => m.vpA !== null).length, n);
    const halfway = { ...event, projection: project(event) };
    assert.ok(teamStandingsThroughRound(halfway, 1).every((s) => s.score === 0));
    assert.ok(teamStandingsThroughRound(halfway, 2).every((s) => s.score === 20));
    score(event);
    assert.ok(
      project(event).standings.every(
        (s) => s.score === 10 * (n - 1) && s.played === (n - 1) * 2 && s.total === (n - 1) * 2,
      ),
    );
    assert.equal(allRoundsComplete(event), true);
    assert.equal(
      apply(store(event), { action: 'settings', status: 'finished' }).event.status,
      'finished',
    );
    assert.throws(
      () => apply(store(event), { action: 'movement', csv: exportMovement(event) }),
      /已有成績/,
    );
    assert.throws(
      () => apply(store(event), { action: 'movement-plan', plan: 'team-interleaved' }),
      /尚未收分/,
    );
    assert.equal(audienceEvent(event).teamMovement, 'interleaved');
  });

test('interleaved comparison uses the paired table across rounds, including split and cancelled awards', () => {
  const event = cycle(3);
  score(event);
  const open = event.assignments.find((a) => a.room === 'open')!;
  const closed = event.assignments.find((a) => a.matchId === open.matchId && a.room === 'closed')!;
  assert.notEqual(open.round, closed.round);
  const x = event.results[resultKey(open.id, open.boards[0])];
  const y = event.results[resultKey(closed.id, closed.boards[0])];
  x.nsScore = 420;
  y.nsScore = 170;
  let match = project(event).matches.find((m) => m.id === open.matchId)!;
  assert.equal(match.marginA, 6);
  assert.equal(match.marginB, -6);
  assert.equal(match.vpA, vp(6, 2));
  x.split = { ns: { ...x, nsScore: 620 }, ew: { ...x, nsScore: 170 } };
  match = project(event).matches.find((m) => m.id === open.matchId)!;
  assert.equal(match.marginA, 10);
  assert.equal(match.marginB, 0);
  x.status = 'cancelled';
  assert.equal(project(event).matches.find((m) => m.id === open.matchId)!.marginA, 0);
  for (const b of open.boards) event.results[resultKey(open.id, b)].status = 'cancelled';
  assert.equal(project(event).matches.find((m) => m.id === open.matchId)!.vpA, null);
});

test('bye VP defaults to 12, accepts fixed awards, waits for collection and never invents board statistics', () => {
  const event = apply(store(fixture(5)), {
    action: 'movement-plan',
    plan: 'team-round-robin',
    byeVp: 11.25,
  }).event;
  const bye = teamByes(event).find((b) => b.round === 1)!;
  assert.equal(project(event).byes![0].awarded, false);
  score(event, 1);
  const p = project(event);
  assert.equal(p.standings.find((s) => s.id === bye.participantId)!.score, 11.25);
  assert.equal(p.standings.find((s) => s.id === bye.participantId)!.played, 0);
  assert.equal(p.standings.find((s) => s.id === bye.participantId)!.secondary, 0);
  assert.equal(
    teamStandingsThroughRound({ ...event, projection: p }, 1).find(
      (s) => s.id === bye.participantId,
    )!.score,
    11.25,
  );
  assert.equal(p.expected, event.assignments.length * 2);
  assert.equal(p.received, 8);
  assert.equal(parseByeVp(exportMovement(event)), 11.25);
  assert.equal(teamButlerStats(event).individual.length, 0);
  const fresh = fixture(5);
  assert.equal(
    apply(store(fresh), { action: 'movement', csv: exportMovement(event) }).event.byeVp,
    11.25,
  );
  assert.throws(
    () => apply(store(event), { action: 'movement', csv: exportMovement({ ...event, byeVp: 12 }) }),
    /輪空 VP/,
  );
  const cleared = apply(store(event), { action: 'clear-results', confirmName: event.name });
  assert.ok(cleared.projection.byes!.every((b) => !b.awarded));
  assert.ok(cleared.projection.standings.every((s) => s.score === 0));
  assert.equal(cleared.event.byeVp, 11.25);
  for (const byeVp of [-1, 21, 1.111, NaN])
    assert.throws(() =>
      apply(store(fresh), { action: 'movement-plan', plan: 'team-round-robin', byeVp }),
    );
  for (const byeVp of [0, 12, 20])
    assert.equal(
      apply(store(fresh), { action: 'movement-plan', plan: 'team-round-robin', byeVp }).event.byeVp,
      byeVp,
    );
});

test('malformed interleaved imports are rejected without changing state', () => {
  const event = cycle(5),
    csv = exportMovement(event);
  const rows = csv.split('\n');
  for (const text of [
    rows.slice(0, -1).join('\n'),
    [...rows, rows[1]].join('\n'),
    csv.replace('cycle-1-2', 'wrong'),
    csv.replace('"open"', '"pairs"'),
  ]) {
    assert.throws(() => apply(store(event), { action: 'movement', csv: text }));
  }
  const copy = structuredClone(event);
  copy.assignments[1].boards = copy.assignments[0].boards;
  assert.throws(() => parseMovement(exportMovement(copy), event));
  assert.equal(Object.keys(event.results).length, 0);
  assert.ok(
    !movementOptions({ ...event, rounds: 3 }).some((o) => o.id.startsWith('team-interleaved')),
  );
  assert.ok(
    !movementOptions({ ...event, boardsPerRound: 26 }).some((o) => o.id === 'team-interleaved'),
  );
});

test('interleaved player statistics wait for all uses and count each appearance once; named players cannot change pair direction', () => {
  const event = cycle(5);
  for (const a of event.assignments)
    a.playerNames = { N: `${a.ns}-N`, S: `${a.ns}-S`, E: `${a.ew}-E`, W: `${a.ew}-W` };
  validateInterleavedLineups(event.assignments);
  score(event, 2);
  assert.equal(teamButlerStats(event).individual.length, 0);
  score(event);
  const stats = teamButlerStats(event);
  assert.equal(stats.individual.length, 20);
  assert.ok(stats.individual.every((p) => p.boards === 8 && p.total === 0 && p.mpPercent === 50));
  event.assignments.find((a) => a.ns === 'p1')!.playerNames!.N = 'p1-E';
  assert.throws(() => validateInterleavedLineups(event.assignments), /不可交換/);
});

test('interleaved groups support all divisible team counts and repeated cycles with regrouping', () => {
  for (const size of [3, 5] as const)
    for (let n = size; n <= 32; n += size) {
      for (const cycles of [1, 2, 3]) {
        const rounds = cycles * (size - 1);
        const draft = fixture(n, rounds, 1);
        const groups = defaultInterleavedGroups(draft, size);
        // Shift roster positions between cycles; both opponents and table seats may change.
        for (let c = 1; c < cycles; c++) {
          const order = draft.participants.map((p) => p.id);
          order.push(...order.splice(0, c));
          groups[c] = Array.from({ length: n / size }, (_, g) =>
            order.slice(g * size, (g + 1) * size),
          );
        }
        const event = apply(store(draft), {
          action: 'movement-plan',
          plan: `team-interleaved-${size}`,
          interleavedGroups: groups,
        }).event;
        assert.equal(event.teamMovement, 'interleaved');
        assert.equal(event.assignments.length, n * rounds);
        assert.equal(event.boards.length, size * cycles);
        assert.equal(interleavedSize(event), size);
        assert.equal(roundLabel(event, size), '2-1');
        assert.equal(roundLabel(event, rounds), `${cycles}-${size - 1}`);
        assert.deepEqual(parseMovement(exportMovement(event), event), event.assignments);
        assert.deepEqual(teamByes(event), []);
        assert.equal(buildMovement(draft, `team-interleaved-${size}`, groups).copies, n / size);
        for (let c = 0; c < cycles; c++)
          for (const group of groups[c])
            for (const id of group) {
              const rows = event.assignments.filter(
                (a) => a.round > c * (size - 1) && a.round <= (c + 1) * (size - 1) && a.ns === id,
              );
              assert.deepEqual(
                new Set(rows.map((a) => a.ew)),
                new Set(group.filter((p) => p !== id)),
              );
              assert.equal(rows.length, size - 1);
            }
        score(event, 1);
        assert.ok(project(event).standings.every((s) => s.score === 0));
        score(event, 2);
        assert.ok(project(event).standings.every((s) => s.score === 20));
        score(event);
        const final = project(event);
        assert.equal(final.matches.length, (n * rounds) / 2);
        assert.ok(final.standings.every((s) => s.score === rounds * 10 && s.played === rounds));
      }
    }
});

test('regrouping is validated atomically and CSV cannot mix cycles or incomplete groups', () => {
  const draft = fixture(6, 4, 1);
  const groups = [
    [
      ['p1', 'p2', 'p3'],
      ['p4', 'p5', 'p6'],
    ],
    [
      ['p1', 'p4', 'p5'],
      ['p2', 'p3', 'p6'],
    ],
  ];
  const saved = apply(store(draft), {
    action: 'movement-plan',
    plan: 'team-interleaved-3',
    interleavedGroups: groups,
  });
  const event = saved.event;
  assert.deepEqual(
    new Set(event.assignments.filter((a) => a.round > 2 && a.ns === 'p1').map((a) => a.ew)),
    new Set(['p4', 'p5']),
  );
  for (const invalid of [
    groups.slice(0, 1),
    [groups[0], groups[0].map((g) => g.map(() => 'p1'))],
    [
      groups[0],
      [
        ['p1', 'p2', 'p3'],
        ['p4', 'p5', 'missing'],
      ],
    ],
  ]) {
    assert.throws(() =>
      apply(store(draft), {
        action: 'movement-plan',
        plan: 'team-interleaved-3',
        interleavedGroups: invalid,
      }),
    );
    assert.equal(draft.teamMovement, undefined);
  }
  const wrong = structuredClone(event);
  for (const a of wrong.assignments.filter((a) => a.round > 2))
    a.boards = a.boards.map((b) => b - 3);
  assert.throws(() => parseMovement(exportMovement(wrong), event), /重複|新牌/);
  const duplicateMatch = structuredClone(event);
  for (const a of duplicateMatch.assignments.filter((a) => a.round > 2)) a.matchId = 'cycle-1-2';
  assert.throws(() => parseMovement(exportMovement(duplicateMatch), event));
  assert.throws(() =>
    parseMovement(exportMovement({ ...event, assignments: event.assignments.slice(1) }), event),
  );
  score(event, 1);
  assert.throws(
    () =>
      apply(store(event), {
        action: 'movement-plan',
        plan: 'team-interleaved-3',
        interleavedGroups: groups,
      }),
    /尚未收分/,
  );
});

test('mode selection and round labels distinguish 3- and 5-team groups and retain bounds', () => {
  const draft = fixture(15, 8, 1);
  assert.deepEqual(
    movementOptions(draft)
      .filter((p) => p.interleavedSize)
      .map((p) => p.interleavedSize),
    [3, 5],
  );
  assert.ok(!movementOptions(fixture(6, 3, 1)).some((p) => p.interleavedSize));
  assert.ok(!movementOptions(fixture(7, 4, 1)).some((p) => p.interleavedSize));
  assert.ok(!movementOptions(fixture(5, 8, 13)).some((p) => p.interleavedSize));
  assert.equal(roundLabel(draft, 4), '4');
  const e = apply(store(fixture(10, 8, 1)), {
    action: 'movement-plan',
    plan: 'team-interleaved-5',
  }).event;
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => roundLabel(e, i + 1)),
    ['1-1', '1-2', '1-3', '1-4', '2-1', '2-2', '2-3', '2-4'],
  );
  assert.equal(roundLabel(e, 0), '0');
});

test('new cycles isolate repeated-opponent scores and allow lineup direction changes only between cycles', () => {
  const event = apply(store(fixture(6, 4, 1)), {
    action: 'movement-plan',
    plan: 'team-interleaved-3',
  }).event;
  score(event);
  const first = event.assignments.find((a) => a.ns === 'p1' && a.ew === 'p2' && a.round <= 2)!;
  const second = event.assignments.find((a) => a.ns === 'p1' && a.ew === 'p2' && a.round > 2)!;
  event.results[resultKey(first.id, first.boards[0])].nsScore = 620;
  event.results[resultKey(second.id, second.boards[0])].nsScore = -100;
  const projection = project(event);
  assert.notEqual(first.matchId, second.matchId);
  assert.equal(projection.matches.find((m) => m.id === first.matchId)!.marginA, 12);
  assert.equal(projection.matches.find((m) => m.id === second.matchId)!.marginA, -3);
  for (const a of event.assignments) {
    a.playerNames = { N: `${a.ns}-N`, S: `${a.ns}-S`, E: `${a.ew}-E`, W: `${a.ew}-W` };
    if (a.round > 2)
      a.playerNames = { N: `${a.ns}-E`, S: `${a.ns}-W`, E: `${a.ew}-N`, W: `${a.ew}-S` };
  }
  assert.doesNotThrow(() => validateInterleavedLineups(event.assignments));
  const stats = teamButlerStats(event);
  assert.equal(stats.individual.length, 24);
  assert.ok(stats.individual.every((p) => p.boards === 4));
  const changed = event.assignments.find((a) => a.round === 4 && a.ew === 'p1')!;
  changed.playerNames!.E = 'p1-E';
  assert.throws(() => validateInterleavedLineups(event.assignments), /同一交錯循環/);
});
