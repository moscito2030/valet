import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema, resultKey, type BridgeEvent } from '../lib/model';
import type { KnockoutNode, KnockoutSource } from '../lib/knockout-schema';
import { knockoutAssignments, seedKnockout } from '../lib/knockout';
import { project } from '../lib/scoring';
import { audienceEvent } from '../lib/read-models/public-event';
import {
  nextScheduledRound,
  previousScheduledRound,
  roundStartProblem,
} from '../lib/round-workflow';
import { tableDeviceKey } from '../lib/table-device';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { StandingsView } from '../components/scoreboard/StandingsView';
import { PenaltyPanel } from '../components/admin/PenaltyPanel';

const team = (id: string): KnockoutSource => ({ kind: 'team', id });
const winner = (id: string): KnockoutSource => ({ kind: 'winner', id });
const loser = (id: string): KnockoutSource => ({ kind: 'loser', id });
const node = (
  id: string,
  a: KnockoutSource,
  b: KnockoutSource,
  startRound: number,
  rounds: number,
  boardsPerRound: number,
  table: number,
): KnockoutNode => ({ id, name: id, a, b, startRound, rounds, boardsPerRound, table });
function apply(e: BridgeEvent, command: object) {
  return applyMutation(
    { event: e, projection: project(e), requests: [] },
    mutationSchema.parse({
      revision: e.revision,
      requestId: randomUUID(),
      reason: '獨立審查反例',
      ...command,
    }),
  ).event;
}
function fixture(nodes: KnockoutNode[]) {
  let e = createEvent({
    name: '反例測試',
    kind: 'teams',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-10-28',
    venue: '',
  });
  e = apply(e, { action: 'knockout-config', nodes });
  return apply(e, { action: 'knockout-publish' });
}
function fill(e: BridgeEvent, id: string, margin = 420, round?: number) {
  for (const a of knockoutAssignments(
    e,
    e.knockout!.nodes.find((n) => n.id === id)!,
  ).filter((a) => !round || a.round === round))
    for (const board of a.boards)
      e.results[resultKey(a.id, board)] = {
        assignmentId: a.id,
        board,
        level: 1,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 7,
        lead: '',
        nsScore: a.room === 'open' ? margin : 0,
        updatedAt: '',
      };
}

test('late publication of a longer concurrent match cannot consume another round board range', () => {
  let e = fixture([
    node('n1', team('t1'), team('t2'), 1, 1, 1, 1),
    node('n2', team('t3'), team('t4'), 1, 3, 1, 2),
    node('n3', winner('n1'), loser('n1'), 2, 1, 1, 1),
    node('n4', winner('n2'), loser('n2'), 5, 1, 4, 2),
    node('n5', winner('n3'), loser('n3'), 3, 1, 1, 1),
  ]);
  fill(e, 'n1', 0);
  e = apply(e, { action: 'knockout-overtime', nodeId: 'n1', boards: 1 });
  fill(e, 'n1', 420, 4);
  e = apply(e, { action: 'knockout-decide', nodeId: 'n1' });
  e = apply(e, { action: 'knockout-publish' });
  fill(e, 'n3');
  e = apply(e, { action: 'knockout-decide', nodeId: 'n3' });
  e = apply(e, { action: 'knockout-publish' });
  fill(e, 'n2');
  e = apply(e, { action: 'knockout-decide', nodeId: 'n2' });
  e = apply(e, { action: 'knockout-publish' });
  const short = knockoutAssignments(
    e,
    e.knockout!.nodes.find((n) => n.id === 'n5')!,
  )[0];
  const long = knockoutAssignments(
    e,
    e.knockout!.nodes.find((n) => n.id === 'n4')!,
  )[0];
  assert.ok(long.boards.every((b) => !short.boards.includes(b)));
});

test('club round controls skip only empty KO rounds created by overtime, never unresolved planned rounds', () => {
  let e = fixture([
    node('n1', team('t1'), team('t2'), 1, 1, 1, 1),
    node('n2', team('t3'), team('t4'), 3, 1, 1, 2),
    node('n3', winner('n1'), loser('n1'), 2, 1, 1, 1),
    node('n4', winner('n3'), loser('n3'), 3, 1, 1, 1),
  ]);
  e.club = { enabled: true, mode: 'table', tokens: {}, confirmations: {}, finalized: [1] };
  e.currentRound = 1;
  e.roundPhase = 'break';
  fill(e, 'n1', 0);
  e = apply(e, { action: 'knockout-overtime', nodeId: 'n1', boards: 1 });
  assert.equal(nextScheduledRound(e, 1), 3);
  assert.equal(previousScheduledRound(e, 3), 1);
  e = apply(e, { action: 'round-control', round: 3, phase: 'playing' });
  assert.equal(e.currentRound, 3);
  assert.throws(() => apply(e, { action: 'round-control', round: 4, phase: 'playing' }), /未結算/);
  fill(e, 'n2');
  e.club!.finalized.push(3);
  e = apply(e, { action: 'round-control', round: 4, phase: 'playing' });
  assert.equal(nextScheduledRound(e, 4), 5);
  assert.match(roundStartProblem(e, 5)!, /安排|公布/);
  assert.throws(() => apply(e, { action: 'round-control', round: 6, phase: 'playing' }), /依序/);
});

test('reopened forfeited downstream can collect again while other settled branch stays public and locked', () => {
  let e = createEvent({
    name: '八隊覆核',
    kind: 'teams',
    teamFormat: 'knockout',
    names: Array.from({ length: 8 }, (_, i) => '隊' + i),
    date: '2026-10-28',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  e = apply(e, { action: 'knockout-publish' });
  e.club = { enabled: true, mode: 'table', tokens: {}, confirmations: {}, finalized: [1] };
  for (const id of ['s1m1', 's1m2', 's1m3', 's1m4']) {
    fill(e, id);
    e = apply(e, { action: 'knockout-decide', nodeId: id });
  }
  e = apply(e, { action: 'knockout-publish' });
  e.currentRound = 2;
  e.roundPhase = 'playing';
  e = apply(e, {
    action: 'knockout-forfeit',
    nodeId: 's2m1',
    loser: e.knockout!.published.s2m1.a,
    withdraw: false,
  });
  fill(e, 's2m2');
  e = apply(e, { action: 'club-finalize', round: 2, force: true });
  e = apply(e, { action: 'knockout-decide', nodeId: 's2m2' });
  const otherIds = knockoutAssignments(
    e,
    e.knockout!.nodes.find((n) => n.id === 's2m2')!,
  ).map((a) => a.id);
  const otherResults = Object.entries(audienceEvent(e).results).filter(([, r]) =>
    otherIds.includes(r.assignmentId),
  );
  e = apply(e, { action: 'knockout-reopen', nodeId: 's1m1' });
  assert.equal(e.club!.finalized.includes(2), false);
  assert.deepEqual(
    Object.entries(audienceEvent(e).results).filter(([, r]) => otherIds.includes(r.assignmentId)),
    otherResults,
  );
  e = apply(e, { action: 'knockout-decide', nodeId: 's1m1' });
  e = apply(e, { action: 'knockout-publish' });
  e.currentRound = 2;
  e.roundPhase = 'playing';
  const a = knockoutAssignments(
    e,
    e.knockout!.nodes.find((n) => n.id === 's2m1')!,
  )[0];
  const hash = 'a'.repeat(64);
  e.club!.tokens[tableDeviceKey(e, a)] = hash;
  e = apply(e, {
    action: 'club-play',
    tokenHash: hash,
    round: 2,
    confirm: false,
    result: {
      assignmentId: a.id,
      board: a.boards[0],
      level: 1,
      strain: 'NT',
      doubled: 1,
      declarer: 'N',
      tricks: 7,
      lead: '',
    },
  });
  assert.ok(e.results[resultKey(a.id, a.boards[0])]);
  assert.equal(audienceEvent(e).results[resultKey(a.id, a.boards[0])], undefined);
  assert.deepEqual(
    Object.entries(audienceEvent(e).results).filter(([, r]) => otherIds.includes(r.assignmentId)),
    otherResults,
  );
  // A retained public table stays device-locked even when a director correction
  // invalidates its old peer confirmation after reopening the decision.
  e = apply(e, { action: 'knockout-reopen', nodeId: 's2m2' });
  const other = e.assignments.find((a) => a.id === otherIds[0])!;
  const input = {
    assignmentId: other.id,
    board: other.boards[0],
    level: 1,
    strain: 'NT',
    doubled: 1,
    declarer: 'N',
    tricks: 8,
    lead: '',
  };
  e = apply(e, { action: 'results', results: [input] });
  e.club!.tokens[tableDeviceKey(e, other)] = 'b'.repeat(64);
  assert.throws(
    () =>
      apply(e, {
        action: 'club-play',
        tokenHash: 'b'.repeat(64),
        round: 2,
        confirm: false,
        result: { ...input, tricks: 9 },
      }),
    /本桌已結算/,
  );
  assert.throws(
    () => apply(e, { action: 'clear-result', assignmentId: other.id, board: other.boards[0] }),
    /本圈已結算/,
  );
  assert.equal(audienceEvent(e).results[resultKey(other.id, other.boards[0])].tricks, 8);
});

test('auto-decided withdrawal or bye nodes with no tables do not block the next playable round', () => {
  const nodes = seedKnockout(['t1', 't2', 't3', 't4'], 1, 1, true);
  nodes.find((n) => n.id === 's2m1')!.startRound = 3;
  let e = fixture(nodes);
  e.club = { enabled: true, mode: 'table', tokens: {}, confirmations: {}, finalized: [1] };
  e.currentRound = 1;
  e.roundPhase = 'break';
  for (const id of ['s1m1', 's1m2'])
    e = apply(e, {
      action: 'knockout-forfeit',
      nodeId: id,
      loser: e.knockout!.published[id].a,
      withdraw: true,
    });
  e = apply(e, { action: 'knockout-publish' });
  assert.equal(e.knockout!.decisions.bronze.winner, '');
  assert.equal(nextScheduledRound(e, 1), 3);
  e = apply(e, { action: 'round-control', round: 3, phase: 'playing' });
  assert.equal(e.currentRound, 3);
});

test('legacy orphan or mismatched results cannot freeze a non-KO stage', () => {
  const e = createEvent({
    name: '舊資料',
    kind: 'teams',
    names: ['A', 'B'],
    date: '2026-10-28',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  for (const a of e.assignments)
    e.results[resultKey(a.id, a.boards[0])] = {
      assignmentId: a.id,
      board: a.boards[0],
      level: 1,
      strain: 'NT',
      doubled: 1,
      declarer: 'N',
      tricks: 7,
      lead: '',
      nsScore: 90,
      updatedAt: '',
    };
  const extra = { ...Object.values(e.results)[0], assignmentId: 'removed' };
  e.results[resultKey(extra.assignmentId, extra.board)] = extra;
  assert.throws(() => apply(e, { action: 'settings', status: 'finished' }), /不在現有賽程/);
  delete e.results[resultKey(extra.assignmentId, extra.board)];
  e.results['wrong-key'] = Object.values(e.results)[0];
  assert.throws(() => apply(e, { action: 'settings', status: 'finished' }), /不在現有賽程/);
});

test('pending pure IMP stage has no VP table or penalty path and can clear legacy VP metadata', () => {
  let e = createEvent({
    name: '尚未編排',
    kind: 'teams',
    teamFormat: 'knockout',
    names: [],
    date: '2026-10-28',
    venue: '',
  });
  e = apply(e, { action: 'participants-setup', names: ['A', 'B'] });
  assert.throws(() => apply(e, { action: 'penalty', participantId: 't1', amount: 1 }), /對局 IMP/);
  e.penalties = { t1: 1 };
  e = apply(e, { action: 'penalty', participantId: 't1', amount: 0 });
  assert.equal(e.penalties!.t1, 0);
  const event = audienceEvent(e),
    noop = () => {};
  const html =
    renderToStaticMarkup(
      createElement(StandingsView, {
        event,
        follow: '',
        id: e.id,
        query: '',
        setPerson: noop,
        setQuery: noop,
        setTab: noop,
        toggleFollow: noop,
      }),
    ) +
    renderToStaticMarkup(
      createElement(PenaltyPanel, { event, busy: false, save: async () => true }),
    );
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /\bVP\b/);
  assert.match(html, /待設定淘汰賽對戰表/);
});
