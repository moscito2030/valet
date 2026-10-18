import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, resultKey, type BridgeEvent, type Result } from '../lib/model';
import { project } from '../lib/scoring';
import { audienceEvent } from '../lib/read-models/public-event';
import { duplicateStage } from '../lib/domain/duplicate-stage';
import { winAwardStats } from '../lib/win-awards';
function fixture(kind: 'teams' | 'pairs' = 'pairs') {
  const e = createEvent({
    name: 'Win awards',
    kind,
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    date: '2026-10-19',
    venue: '',
    rounds: 3,
    boardsPerRound: 1,
  });
  e.winAward = { enabled: true, win: 2, loss: 0, draw: 1 };
  return e;
}
function fill(e: BridgeEvent, values: (a: BridgeEvent['assignments'][number]) => number) {
  for (const a of e.assignments)
    for (const board of a.boards) {
      const r: Result = {
        assignmentId: a.id,
        board,
        level: 1,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 7,
        lead: '',
        nsScore: values(a),
        updatedAt: '',
      };
      e.results[resultKey(a.id, board)] = r;
    }
}
const stats = (e: BridgeEvent) => winAwardStats({ ...e, projection: project(e) });
test('pair MP counts win/draw/loss per round, supports Neuberg and ignores ranking penalties', () => {
  const e = fixture();
  fill(e, (a) => (a.table === 1 ? 400 : a.table === 2 ? 100 : -100));
  const rows = stats(e);
  for (const a of e.assignments) {
    const entry = rows.find((r) => r.id === a.ns)!.entries.find((r) => r.round === a.round)!;
    assert.equal(entry.outcome, a.table === 1 ? 'win' : a.table === 2 ? 'draw' : 'loss');
  }
  assert.equal(
    rows.reduce((n, r) => n + r.win, 0),
    6,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.draw, 0),
    6,
  );
  for (const r of rows) assert.equal(r.units, r.win * 2 + r.draw);
  e.penalties = Object.fromEntries(e.participants.map((p) => [p.id, 99]));
  e.neuberg = true;
  assert.deepEqual(stats(e), rows);
  e.winAward!.draw = 0;
  for (const r of stats(e)) assert.equal(r.units, r.win * 2);
});
test('pairs IMP uses round sum and Double Winner groups retain individual statistics', () => {
  const e = fixture();
  fill(e, (a) => (a.table === 1 ? 400 : a.table === 2 ? 100 : -200));
  e.participants.forEach((p, i) => {
    p.group = i < 3 ? 'NS' : 'EW';
  });
  for (const method of ['butler', 'crossimp'] as const) {
    e.pairMethod = method;
    const rows = stats(e);
    assert.equal(
      rows.reduce((n, r) => n + r.win, 0),
      6,
    );
    assert.equal(
      rows.reduce((n, r) => n + r.draw, 0),
      6,
    );
    assert.equal(rows[0].group, 'NS');
    assert.equal(rows[5].group, 'EW');
  }
});
test('incomplete and singleton comparisons are not wins; cancelled rounds are not draws', () => {
  const e = fixture();
  assert.ok(stats(e).every((r) => r.pending === 3 && r.units === 0));
  fill(e, () => 100);
  const a = e.assignments[0];
  delete e.results[resultKey(a.id, a.boards[0])];
  assert.ok(stats(e).every((r) => r.pending === 1));
  fill(e, () => 100);
  for (const r of Object.values(e.results)) r.status = 'cancelled';
  assert.ok(stats(e).every((r) => r.excluded === 3 && r.draw === 0));
  const r = e.results[resultKey(a.id, a.boards[0])];
  r.status = 'played';
  assert.ok(stats(e).every((row) => row.excluded === 3));
});
test('teams count completed matches by each side IMP, including split scores and no bye awards', () => {
  const e = fixture('teams');
  fill(e, (a) => (a.room === 'open' ? 420 : 170));
  let rows = stats(e);
  assert.equal(
    rows.reduce((n, r) => n + r.win, 0),
    9,
  );
  assert.equal(
    rows.reduce((n, r) => n + r.loss, 0),
    9,
  );
  e.penalties = { t1: 100 };
  assert.deepEqual(stats(e), rows);
  const open = e.assignments.find((a) => a.room === 'open')!;
  const r = e.results[resultKey(open.id, open.boards[0])];
  r.split = { ns: { ...r, nsScore: 420 }, ew: { ...r, nsScore: 0 } };
  const changed = stats(e);
  assert.equal(
    changed.reduce((n, r) => n + r.win, 0),
    10,
  );
  for (const r of Object.values(e.results)) r.status = 'cancelled';
  assert.ok(stats(e).every((r) => r.excluded === 3 && r.draw === 0));
  const bye = fixture('teams');
  bye.participants.pop();
  bye.assignments = bye.assignments.filter((a) => a.ns !== 't6' && a.ew !== 't6');
  fill(bye, () => 100);
  rows = stats(bye);
  assert.equal(
    rows.reduce((n, r) => n + r.draw, 0),
    12,
  );
});
test('club visibility withholds unpublished round awards and corrections update statistics', () => {
  const e = fixture();
  fill(e, (a) => Number(a.table) * 100);
  e.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [1] };
  let rows = winAwardStats(audienceEvent(e));
  assert.ok(rows.every((r) => r.pending === 2 && r.win + r.loss + r.draw === 1));
  fill(e, () => 100);
  rows = winAwardStats(audienceEvent(e));
  assert.ok(rows.every((r) => r.draw === 1 && r.pending === 2));
});
test('win award settings persist, clone and validate without changing rankings', () => {
  const e = fixture();
  fill(e, () => 100);
  const projection = project(e);
  const cmd = mutationSchema.parse({
    action: 'settings',
    status: 'live',
    revision: e.revision,
    requestId: randomUUID(),
    reason: '設定勝場獎',
    winAward: { enabled: true, win: 2, loss: 0, draw: 0 },
  });
  if (cmd.action !== 'settings') throw new Error('Unexpected command');
  const saved = applyMutation({ event: e, projection, requests: [] }, cmd);
  assert.deepEqual(saved.projection.standings, projection.standings);
  assert.deepEqual(audienceEvent(saved.event).winAward, cmd.winAward);
  assert.deepEqual(duplicateStage(saved.event, 'copy').winAward, cmd.winAward);
  for (const value of [-1, Infinity, NaN, 10001])
    assert.equal(
      mutationSchema.safeParse({ ...cmd, winAward: { ...cmd.winAward, win: value } }).success,
      false,
    );
});

test('multi-board pairs aggregate the full round and partial cancellations keep valid boards', () => {
  const e = fixture();
  for (const a of e.assignments) a.boards = [a.boards[0], a.boards[0] + 3];
  e.boards.push(...e.boards.map((b) => ({ ...b, number: b.number + 3 })));
  fill(e, (a) => (a.table === 1 ? 400 : a.table === 2 ? 100 : -200));
  for (const a of e.assignments)
    e.results[resultKey(a.id, a.boards[1])].nsScore =
      a.table === 1 ? -200 : a.table === 2 ? 100 : 400;
  assert.ok(stats(e).every((r) => r.draw === 3 && r.units === 3));
  for (const a of e.assignments) e.results[resultKey(a.id, a.boards[1])].status = 'cancelled';
  assert.equal(
    stats(e).reduce((n, r) => n + r.win, 0),
    6,
  );
});

test('interleaved teams count each two-room match once at the later round', async () => {
  const { interleavedAssignments } = await import('../lib/team-movement');
  const e = createEvent({
    name: 'triangle',
    kind: 'teams',
    names: ['A', 'B', 'C'],
    date: '2026-10-19',
    venue: '',
    rounds: 2,
    boardsPerRound: 1,
  });
  e.assignments = interleavedAssignments(e, 3);
  e.teamMovement = 'interleaved';
  fill(e, (a) => (a.room === 'open' ? 400 : 100));
  const rows = stats(e);
  assert.equal(
    rows.reduce((n, r) => n + r.win + r.loss + r.draw, 0),
    6,
  );
  assert.ok(rows.every((r) => r.entries.every((entry) => entry.round === 2)));
});
