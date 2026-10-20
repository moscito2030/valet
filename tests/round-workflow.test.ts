import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createEvent, applyMutation, makeBoard } from '../lib/events';
import { mutationSchema, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { audienceEvent, clubView } from '../lib/club-view';
import { readyBoardGroups } from '../lib/board-publication-ready';
import { roundHasActivity } from '../lib/round-workflow';
import { RoundControlPanel } from '../components/admin/RoundControlPanel';
import { ClubAdmin } from '../components/club-admin';

function setup() {
  const event = createEvent({
    name: 'Round workflow',
    kind: 'pairs',
    names: ['甲乙', '丙丁', '戊己', '庚辛'],
    date: '2026-10-21',
    venue: '',
    rounds: 3,
    boardsPerRound: 2,
  });
  event.boards = event.boards.map((b) => ({
    ...b,
    deal: makeBoard(b.number).deal,
    published: false,
  }));
  let state: StoredEvent = { event, projection: project(event), requests: [] };
  const apply = (body: object) => {
    state = applyMutation(
      state,
      mutationSchema.parse({
        revision: state.event.revision,
        requestId: randomUUID(),
        reason: '圈次流程測試',
        ...body,
      }),
    );
    return state;
  };
  apply({ action: 'club-config', enabled: true });
  event.participants.forEach((p, i) =>
    apply({
      action: 'club-config',
      enabled: true,
      participantId: p.id,
      tokenHash: (i + 1).toString().repeat(64),
    }),
  );
  const start = (round: number) => apply({ action: 'round-control', round, phase: 'playing' });
  const complete = (round: number) => {
    for (const a of state.event.assignments.filter((a) => a.round === round))
      apply({ action: 'club-complete-table', assignmentId: a.id, round });
  };
  return {
    get state() {
      return state;
    },
    apply,
    start,
    complete,
  };
}

test('linear controls cannot skip unsettled rounds, pause preserves scores, and rollback requires no history', () => {
  const s = setup();
  assert.throws(() => s.start(2), /不可跳圈/);
  s.start(1);
  s.apply({ action: 'round-control', round: 0, phase: 'playing' });
  assert.equal(s.state.event.currentRound, 0);
  s.start(1);
  s.apply({ action: 'round-control', round: 1, phase: 'break' });
  const a = s.state.event.assignments[0],
    token = s.state.event.club!.tokens[a.ns];
  const play = {
    action: 'club-play',
    round: 1,
    confirm: false,
    tokenHash: token,
    result: {
      assignmentId: a.id,
      board: a.boards[0],
      level: 3,
      strain: 'NT',
      doubled: 1,
      declarer: 'N',
      tricks: 9,
      lead: '',
    },
  };
  assert.throws(() => s.apply(play), /不開放/);
  assert.throws(() => s.start(2), /前圈未結算/);
  s.start(1);
  s.apply(play);
  assert.throws(() => s.apply({ action: 'round-control', round: 0, phase: 'playing' }), /不能退圈/);
  s.apply({ action: 'clear-result', assignmentId: a.id, board: a.boards[0] });
  assert.ok(roundHasActivity(s.state.event, 1));
  assert.throws(() => s.apply({ action: 'round-control', round: 0, phase: 'playing' }), /不能退圈/);
});

test('director confirms last table once, publishes cancelled outcomes, pauses, and last round enters review', () => {
  const s = setup(),
    tokens = structuredClone(s.state.event.club!.tokens);
  for (let round = 1; round <= 3; round++) {
    s.start(round);
    const revision = s.state.event.revision;
    s.complete(round);
    assert.equal(s.state.event.revision, revision + 2);
    assert.equal(s.state.event.currentRound, round);
    assert.equal(s.state.event.roundPhase, 'break');
    assert.deepEqual(
      s.state.event.club!.finalized,
      Array.from({ length: round }, (_, i) => i + 1),
    );
    assert.deepEqual(s.state.event.club!.tokens, tokens);
    assert.throws(() => s.start(round), /已結算|覆核/);
    assert.equal(Object.keys(audienceEvent(s.state.event).results).length, round * 4);
  }
  assert.equal(s.state.event.status, 'review');
  assert.equal(clubView(s.state.event, s.state.event.participants[0].id).finalized, true);
});

test('force settle and advance is atomic; an unready next round leaves all state untouched', () => {
  const s = setup();
  s.start(1);
  const later = s.state.event.assignments.filter((a) => a.round === 2);
  s.state.event.assignments = s.state.event.assignments.filter((a) => a.round !== 2);
  const before = structuredClone(s.state);
  assert.throws(
    () => s.apply({ action: 'club-finalize', round: 1, force: true, advance: true }),
    /安排/,
  );
  assert.deepEqual(s.state, before);
  s.state.event.assignments.push(...later);
  s.apply({ action: 'club-finalize', round: 1, force: true, advance: true });
  assert.deepEqual(s.state.event.club!.finalized, [1]);
  assert.equal(s.state.event.currentRound, 2);
  assert.equal(s.state.event.roundPhase, 'playing');
  s.apply({ action: 'club-finalize', round: 2, force: true, advance: false });
  assert.equal(s.state.event.currentRound, 2);
  assert.equal(s.state.event.roundPhase, 'break');
});

test('a stale concurrent transition cannot overwrite settlement or publish boards', () => {
  const s = setup();
  s.start(1);
  const revision = s.state.event.revision;
  s.complete(1);
  const before = s.state;
  assert.throws(
    () => s.apply({ action: 'round-control', round: 2, phase: 'playing', revision }),
    /更新/,
  );
  assert.equal(s.state, before);
});

test('board publication waits for every scheduled use and all group members; no polling writes', () => {
  const s = setup();
  s.start(1);
  assert.deepEqual(readyBoardGroups(s.state.event), []);
  s.complete(1);
  const original = structuredClone(s.state);
  const groups = readyBoardGroups(s.state.event);
  assert.equal(groups.length, 1);
  assert.deepEqual(s.state, original);
  const board = groups[0][0].number;
  const later = s.state.event.assignments.find((a) => a.round === 3)!;
  later.boards.push(board);
  assert.deepEqual(readyBoardGroups(s.state.event), []);
  later.boards.pop();
  const missing = s.state.event.assignments.filter((a) => a.round === 3);
  s.state.event.assignments = s.state.event.assignments.filter((a) => a.round !== 3);
  assert.deepEqual(readyBoardGroups(s.state.event), []);
  s.state.event.assignments.push(...missing);
  assert.equal(readyBoardGroups(s.state.event).length, 1);
  s.state.event.boards.find((b) => b.number === board)!.deal.N = [];
  assert.deepEqual(readyBoardGroups(s.state.event), []);
});

test('publish plus next round is one audited write and rejects unsafe groups atomically', () => {
  const s = setup();
  s.start(1);
  s.complete(1);
  const group = readyBoardGroups(s.state.event)[0];
  const before = s.state;
  assert.throws(
    () => s.apply({ action: 'round-control', round: 2, phase: 'playing', publishGroups: [999] }),
    /尚未全部完成/,
  );
  assert.equal(s.state, before);
  s.apply({
    action: 'round-control',
    round: 2,
    phase: 'playing',
    publishGroups: [group[0].number],
  });
  assert.equal(s.state.event.revision, before.event.revision + 1);
  assert.equal(s.state.event.currentRound, 2);
  assert.ok(
    group.every(
      (b) => audienceEvent(s.state.event).boards.find((p) => p.number === b.number)!.published,
    ),
  );
  assert.match(s.state.event.audit.at(-1)!.detail!, /公開牌型/);
  assert.equal(readyBoardGroups(s.state.event).length, 0);
});

test('skip publication still starts next round and preserves private deals', () => {
  const s = setup();
  s.start(1);
  s.complete(1);
  s.start(2);
  assert.ok(s.state.event.boards.every((b) => !b.published));
  assert.ok(audienceEvent(s.state.event).boards.every((b) => !('deal' in b)));
});

test('director interface shows one next step, hides device setup, and has no phase dropdown', () => {
  const s = setup();
  const render = () =>
    renderToStaticMarkup(
      createElement(RoundControlPanel, {
        event: { ...audienceEvent(s.state.event), club: s.state.event.club, canDirect: true },
        busy: false,
        save: async () => true,
      }),
    );
  assert.match(render(), /開始第 1 圈/);
  assert.doesNotMatch(render(), /<select/);
  s.start(1);
  assert.match(render(), /暫停收分/);
  s.complete(1);
  assert.match(render(), /圈間休息/);
  assert.match(render(), /開始第 2 圈/);
  const tools = renderToStaticMarkup(
    createElement(ClubAdmin, {
      event: { ...audienceEvent(s.state.event), club: s.state.event.club, canDirect: true },
      reload: async () => undefined,
    }),
  );
  assert.match(tools, /裝置、QRCode 與輸入方設定/);
  assert.doesNotMatch(tools, /<select|<details|手機可連線的網站網址/);
});

test('collection console keeps four controls and locks mutations after settlement', () => {
  const s = setup();
  const render = () =>
    renderToStaticMarkup(
      createElement(RoundControlPanel, {
        event: { ...audienceEvent(s.state.event), club: s.state.event.club, canDirect: true },
        busy: false,
        save: async () => true,
        collection: { expanded: false, pending: 2, total: 2, toggle() {}, finish() {} },
      }),
    );
  assert.match(render(), /aria-label="開始第 1 圈"/);
  s.start(1);
  assert.match(render(), /aria-label="收分控制台"/);
  assert.match(render(), /aria-label="暫停收分"/);
  assert.match(render(), /aria-controls="club-round-tables"/);
  assert.match(render(), /aria-label="提前結束本圈"/);
  s.apply({ action: 'round-control', round: 1, phase: 'break' });
  assert.match(render(), /aria-label="繼續本圈收分"/);
  s.complete(1);
  assert.match(render(), /aria-label="開始第 2 圈"/);
  assert.match(render(), /disabled="" aria-label="提前結束本圈"/);
});
