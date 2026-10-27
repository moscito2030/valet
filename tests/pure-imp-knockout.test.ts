import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation, seedEvents } from '../lib/events';
import {
  createSchema,
  mutationSchema,
  resultKey,
  type BridgeEvent,
  type StoredEvent,
} from '../lib/model';
import { currentKnockoutScore, knockoutAssignments, seedKnockout } from '../lib/knockout';
import { project } from '../lib/scoring';
import { allRoundsComplete } from '../lib/round-progress';
import { audienceEvent } from '../lib/read-models/public-event';
import { exportKnockoutCsv, knockoutPrintHtml, knockoutReportRows } from '../lib/knockout-report';
import { canMutate } from '../lib/mutation-permissions';
import { hydrateEvent } from '../lib/storage/hydrate-event';
import { competitionInfo } from '../lib/competitions';
import { exportPbn, parseCsv } from '../lib/imports';
import { createLocalRepository } from '../lib/storage/local';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function fixture(count = 4, legs = 1) {
  const e = createEvent({
    name: '純 IMP',
    kind: 'teams',
    teamFormat: 'knockout',
    teamMethod: 'imp',
    names: Array.from({ length: count }, (_, i) => 'Team ' + i),
    date: '2026-10-28',
    venue: '',
    rounds: legs,
    boardsPerRound: 2,
  });
  return apply(e, { action: 'knockout-publish' });
}
function apply(e: BridgeEvent, command: object) {
  return applyMutation(
    { event: e, projection: project(e), requests: [] },
    mutationSchema.parse({
      revision: e.revision,
      requestId: randomUUID(),
      reason: '裁判測試原因',
      ...command,
    }),
  ).event;
}
function fill(e: BridgeEvent, nodeId: string, margin = 420, onlyRound?: number) {
  const node = e.knockout!.nodes.find((n) => n.id === nodeId)!;
  for (const a of knockoutAssignments(e, node).filter((a) => !onlyRound || a.round === onlyRound)) {
    for (const board of a.boards)
      e.results[resultKey(a.id, board)] = {
        assignmentId: a.id,
        board,
        level: 1,
        strain: 'NT',
        declarer: 'N',
        doubled: 1,
        tricks: 7,
        lead: '',
        nsScore: a.room === 'open' ? margin : 0,
        updatedAt: '',
      };
  }
}

test('creation supports pending and seeded pure IMP, validates teams and preserves non-KO VP', () => {
  const empty = createEvent({
    name: '待名單',
    kind: 'teams',
    teamFormat: 'knockout',
    names: [],
    date: '2026-10-28',
    venue: '',
  });
  assert.equal(empty.teamFormat, 'knockout');
  assert.equal(empty.rounds, 0);
  assert.throws(
    () =>
      createSchema.parse({
        name: '待名單',
        kind: 'teams',
        teamFormat: 'knockout',
        teamMethod: 'bam',
        names: [],
        date: '2026-10-28',
        venue: '',
      }),
    /純 IMP/,
  );
  const e = fixture(4, 3);
  fill(e, 's1m1');
  assert.equal(currentKnockoutScore(e, e.knockout!.nodes[0]).a, 54);
  assert.ok(project(e).matches.every((m) => m.vpA === null && m.vpB === null));
  assert.ok(project(e).standings.every((s) => s.score === null && s.rank === 0));
  const league = { ...e, knockout: undefined, teamFormat: 'league' as const };
  assert.ok(project(league).matches.some((m) => m.vpA !== null));
});

test('IMP adjustment changes the winner; confirmed adjustment and result edits require reopen', () => {
  let e = fixture(2);
  fill(e, 's1m1');
  e = apply(e, { action: 'knockout-adjust', nodeId: 's1m1', a: -20, b: 0 });
  const score = currentKnockoutScore(e, e.knockout!.nodes[0]);
  assert.deepEqual([score.a, score.b], [-2, 2]);
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1' });
  assert.equal(e.knockout!.decisions.s1m1.winner, e.knockout!.published.s1m1.b);
  assert.throws(
    () => apply(e, { action: 'knockout-adjust', nodeId: 's1m1', a: 0, b: 0 }),
    /已確認/,
  );
  assert.throws(
    () => apply(e, { action: 'penalty', participantId: 't1', amount: 100 }),
    /對局 IMP/,
  );
  e = apply(e, { action: 'knockout-reopen', nodeId: 's1m1' });
  e = apply(e, { action: 'knockout-adjust', nodeId: 's1m1', a: 0, b: 0 });
  assert.equal(currentKnockoutScore(e, e.knockout!.nodes[0]).a, 18);
});

test('repeated tie overtime keeps results and shifts final; unequal leg sizes and all legs accumulate', () => {
  let e = fixture();
  fill(e, 's1m1', 0);
  fill(e, 's1m2');
  const original = structuredClone(e.results);
  e = apply(e, { action: 'knockout-overtime', nodeId: 's1m1', boards: 1 });
  assert.equal(e.knockout!.extraLegs!.s1m1[0].round, 2);
  assert.equal(e.knockout!.nodes.find((n) => n.id === 's2m1')!.startRound, 3);
  assert.deepEqual(e.results, original);
  assert.throws(() => apply(e, { action: 'knockout-decide', nodeId: 's1m1' }), /尚未收齊/);
  fill(e, 's1m1', 0, 2);
  e = apply(e, { action: 'knockout-overtime', nodeId: 's1m1', boards: 3 });
  fill(e, 's1m1', 420, 3);
  assert.equal(currentKnockoutScore(e, e.knockout!.nodes[0]).a, 27);
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1' });
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m2' });
  e = apply(e, { action: 'knockout-publish' });
  assert.equal(e.knockout!.nodes.find((n) => n.id === 's2m1')!.startRound, 4);
  const oldBoards = new Set(knockoutAssignments(e, e.knockout!.nodes[0]).flatMap((a) => a.boards));
  assert.ok(
    knockoutAssignments(
      e,
      e.knockout!.nodes.find((n) => n.id === 's2m1')!,
    ).every((a) => a.boards.every((b) => !oldBoards.has(b))),
  );
  assert.equal(
    apply(e, { action: 'knockout-reopen', nodeId: 's1m1' }).knockout!.published.s2m1,
    undefined,
  );
});

test('overtime rejects incomplete, non-tied, excessive paths and completed tournaments', () => {
  let e = fixture(2);
  assert.throws(
    () => apply(e, { action: 'knockout-overtime', nodeId: 's1m1', boards: 1 }),
    /尚未收齊/,
  );
  fill(e, 's1m1');
  assert.throws(() => apply(e, { action: 'knockout-overtime', nodeId: 's1m1', boards: 1 }), /平手/);
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1' });
  e = apply(e, { action: 'settings', status: 'finished' });
  for (const command of [
    { action: 'knockout-adjust', a: 1, b: 0 },
    { action: 'knockout-overtime', boards: 1 },
    { action: 'knockout-forfeit', loser: 't1', withdraw: false },
  ])
    assert.throws(() => apply(e, { ...command, nodeId: 's1m1' }), /已結束/);
});

test('partial-match forfeit keeps played scores, invents no results, can finalize without missing boards', () => {
  let e = fixture(2, 2);
  const a = e.assignments[0];
  e.results[resultKey(a.id, a.boards[0])] = {
    assignmentId: a.id,
    board: a.boards[0],
    level: 1,
    strain: 'NT',
    declarer: 'N',
    doubled: 1,
    tricks: 7,
    lead: '',
    nsScore: 90,
    updatedAt: '',
  };
  e = apply(e, { action: 'knockout-forfeit', nodeId: 's1m1', loser: 't1', withdraw: false });
  assert.equal(Object.keys(e.results).length, 1);
  assert.equal(e.knockout!.decisions.s1m1.method, 'forfeit');
  assert.equal(allRoundsComplete(e), true);
  assert.equal(project(e).expected, 1);
  assert.equal(project(e).standings.find((s) => s.id === 't2')?.rank, 1);
  const finalized = apply(e, { action: 'settings', status: 'finished' });
  assert.equal(finalized.status, 'finished');
});

test('withdrawal bypasses only later loser routes, distinct from a seeded bye; reopen restores eligibility', () => {
  let e = createEvent({
    name: '雙方退賽',
    kind: 'teams',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-10-28',
    venue: '',
  });
  e = apply(e, {
    action: 'knockout-config',
    nodes: seedKnockout(
      e.participants.map((p) => p.id),
      1,
      2,
      true,
    ),
  });
  e = apply(e, { action: 'knockout-publish' });
  for (const id of ['s1m1', 's1m2'])
    e = apply(e, {
      action: 'knockout-forfeit',
      nodeId: id,
      loser: e.knockout!.published[id].a,
      withdraw: true,
    });
  e = apply(e, { action: 'knockout-publish' });
  assert.equal(e.knockout!.decisions.bronze.winner, '');
  assert.equal(e.knockout!.decisions.bronze.method, 'withdrawal');
  assert.equal(Object.keys(e.results).length, 0);
});

test('withdrawal and forfeit downstream protection with placement matches', () => {
  let e = createEvent({
    name: '順位賽',
    kind: 'teams',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-10-28',
    venue: '',
  });
  e = apply(e, {
    action: 'knockout-config',
    nodes: seedKnockout(
      e.participants.map((p) => p.id),
      1,
      2,
      true,
    ),
  });
  e = apply(e, { action: 'knockout-publish' });
  const loser = e.knockout!.published.s1m1.a;
  e = apply(e, { action: 'knockout-forfeit', nodeId: 's1m1', loser, withdraw: true });
  fill(e, 's1m2');
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m2' });
  e = apply(e, { action: 'knockout-publish' });
  assert.equal(e.knockout!.published.bronze.b, null);
  assert.equal(e.knockout!.decisions.bronze.method, 'withdrawal');
  assert.equal(e.knockout!.decisions.bronze.winner, e.knockout!.decisions.s1m2.loser);
  const reopened = apply(e, { action: 'knockout-reopen', nodeId: 's1m1' });
  assert.equal(reopened.knockout!.withdrawn?.[loser], undefined);
  assert.equal(reopened.knockout!.published.bronze, undefined);
  fill(e, 's2m1');
  assert.throws(() => apply(e, { action: 'knockout-reopen', nodeId: 's1m1' }), /後續對局已有成績/);
});

test('reports contain extra legs, adjustments, decision reasons, teams and places; escape HTML and CSV formulas', () => {
  let e = fixture(2);
  fill(e, 's1m1', 0);
  e = apply(e, { action: 'knockout-overtime', nodeId: 's1m1', boards: 1 });
  fill(e, 's1m1', 420, 2);
  e = apply(e, { action: 'knockout-adjust', nodeId: 's1m1', a: -1, b: 0, reason: '遲到扣分' });
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1', reason: '加賽完成' });
  e.participants[0].name = '=SUM(1,2)<script>';
  const report = { ...e, projection: project(e) };
  const rows = knockoutReportRows(report);
  assert.ok(rows.every((r) => r.length === rows[0].length));
  const csv = exportKnockoutCsv(report);
  assert.ok(csv.includes('加賽節') && csv.includes('遲到扣分') && csv.includes('加賽完成'));
  const summary = parseCsv(csv).find((r) => r['紀錄'] === '對局合計')!;
  assert.equal(summary['累積A'], '8');
  assert.equal(summary['勝方名次'], '1');
  const html = knockoutPrintHtml(report);
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
  assert.ok(!/\bVP\b/.test(csv + html));
});

test('old knockout snapshots are recomputed without migrating data or invalidating confirmed bases', () => {
  let e = fixture(2);
  delete e.teamFormat;
  fill(e, 's1m1');
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1' });
  const stored: StoredEvent = {
    event: e,
    projection: project({ ...e, knockout: undefined }),
    requests: [],
  };
  const original = structuredClone(stored);
  const hydrated = hydrateEvent(stored, competitionInfo(e));
  assert.ok(hydrated.projection.matches.every((m) => m.vpA === null));
  assert.deepEqual(stored, original);
  assert.ok(audienceEvent(e, original.projection).projection.matches.every((m) => m.vpA === null));
  assert.equal(apply(e, { action: 'settings', status: 'finished' }).status, 'finished');
});

test('new decisions require director role and strict finite bounded schema', () => {
  for (const input of [
    { action: 'knockout-adjust', a: -1, b: 0 },
    { action: 'knockout-overtime', boards: 2 },
    { action: 'knockout-forfeit', loser: 't1', withdraw: true },
  ]) {
    const c = mutationSchema.parse({
      revision: 1,
      requestId: randomUUID(),
      reason: '裁判操作',
      nodeId: 's1m1',
      ...input,
    });
    assert.equal(canMutate('admin', c), false);
    assert.equal(canMutate('director', c), true);
    assert.throws(() => mutationSchema.parse({ ...c, reason: '' }));
  }
});

test('local repository round-trip preserves overtime and decisions, audit and optimistic conflicts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'valet-imp-'));
  try {
    const repo = createLocalRepository(directory);
    let e = fixture(2);
    fill(e, 's1m1', 0);
    await repo.insertEvent(e);
    const command = mutationSchema.parse({
      action: 'knockout-overtime',
      nodeId: 's1m1',
      boards: 1,
      revision: e.revision,
      requestId: randomUUID(),
      reason: '追加一牌加賽',
    });
    const saved = await repo.mutateEvent(e.id, command);
    assert.equal(saved.event.knockout!.extraLegs!.s1m1.length, 1);
    assert.match(saved.event.audit.at(-1)!.action, /加賽/);
    assert.deepEqual((await repo.getEvent(e.id)).event.knockout, saved.event.knockout);
    const duplicate = await repo.mutateEvent(e.id, command);
    assert.equal(duplicate.event.revision, saved.event.revision);
    await assert.rejects(
      repo.mutateEvent(e.id, { ...command, requestId: randomUUID() }),
      /其他操作更新/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('overtime respects total player-board limits, atomically leaving the old event unchanged', () => {
  let e = createEvent({
    name: '上限測試',
    kind: 'teams',
    teamFormat: 'knockout',
    names: ['A', 'B'],
    date: '2026-10-28',
    venue: '',
    rounds: 64,
    boardsPerRound: 16,
  });
  e = apply(e, { action: 'knockout-publish' });
  fill(e, 's1m1', 0);
  const before = structuredClone(e);
  assert.throws(
    () => apply(e, { action: 'knockout-overtime', nodeId: 's1m1', boards: 1 }),
    /1024 牌/,
  );
  assert.deepEqual(e, before);
});

test('forfeit exemptions match the exact node, never another node with a shared ID prefix', () => {
  let e = createEvent({
    name: '識別碼測試',
    kind: 'teams',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-10-28',
    venue: '',
  });
  const nodes = seedKnockout(
    e.participants.map((p) => p.id),
    1,
    2,
  );
  nodes[1].id = 's1m1-r2';
  nodes[2].b = { kind: 'winner', id: nodes[1].id };
  e = apply(e, { action: 'knockout-config', nodes });
  e = apply(e, { action: 'knockout-publish' });
  e = apply(e, { action: 'knockout-forfeit', nodeId: 's1m1', loser: 't1', withdraw: false });
  assert.equal(project(e).expected, 4);
});

test('club settlement skips forfeited assignments without cancelling unplayed boards or hiding confirmed played scores', () => {
  let e = fixture();
  e.club = { enabled: true, mode: 'table', tokens: {}, confirmations: {}, finalized: [] };
  e.currentRound = 1;
  fill(e, 's1m1');
  const source = e.assignments.find((a) => a.matchId === 'ko-s1m1-r1')!;
  delete e.results[resultKey(source.id, source.boards[0])];
  e = apply(e, { action: 'knockout-forfeit', nodeId: 's1m1', loser: 't1', withdraw: false });
  assert.equal(Object.keys(audienceEvent(e).results).length, 3);
  fill(e, 's1m2');
  const count = Object.keys(e.results).length;
  e = apply(e, { action: 'club-finalize', round: 1, force: true });
  assert.equal(Object.keys(e.results).length, count);
  assert.equal(e.results[resultKey(source.id, source.boards[0])], undefined);
  assert.deepEqual(e.club!.finalized, [1]);
});

test('new overtime deals import separately after regular scores; scored deals are immutable', () => {
  let e = fixture(2);
  fill(e, 's1m1', 0);
  e = apply(e, { action: 'knockout-overtime', nodeId: 's1m1', boards: 1 });
  const number = e.knockout!.extraLegs!.s1m1[0].boards[0];
  const board = seedEvents()[0].event.boards[0];
  const results = structuredClone(e.results);
  e = apply(e, { action: 'pbn', pbn: exportPbn({ boards: [{ ...board, number }] }) });
  assert.equal(e.boards.find((b) => b.number === number)!.deal.N.length, 13);
  assert.deepEqual(e.results, results);
  assert.throws(
    () => apply(e, { action: 'pbn', pbn: exportPbn({ boards: [{ ...board, number: 1 }] }) }),
    /已收分牌號/,
  );
});
