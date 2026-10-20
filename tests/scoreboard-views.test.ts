import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicationPanel } from '../components/admin/PublicationPanel';
import { RoundControlPanel } from '../components/admin/RoundControlPanel';
import { BoardsView } from '../components/scoreboard/BoardsView';
import { MatchVpScale } from '../components/match-vp-scale';
import { PlayersView } from '../components/scoreboard/PlayersView';
import { RoundsView } from '../components/scoreboard/RoundsView';
import { StandingsView } from '../components/scoreboard/StandingsView';
import { audienceEvent } from '../lib/club-view';
import { applyMutation, createEvent } from '../lib/events';
import { mutationSchema, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';

const noop = () => {};
function fixture() {
  const event = createEvent({
    name: '介面回歸測試',
    kind: 'teams',
    date: '2026-10-18',
    venue: '',
    names: ['甲隊', '乙隊', '丙隊', '丁隊'],
    rounds: 1,
    boardsPerRound: 2,
  });
  event.participants[0].captain = '隊長甲';
  event.participants[0].players = '賽員一;賽員二';
  return event;
}

test('standings search finds captains and players without showing the empty state', () => {
  const raw = fixture(),
    event = audienceEvent(raw, project(raw));
  const render = (query: string) =>
    renderToStaticMarkup(
      createElement(StandingsView, {
        event,
        query,
        id: event.id,
        follow: '',
        setPerson: noop,
        setQuery: noop,
        setTab: noop,
        toggleFollow: noop,
      }),
    );
  for (const query of ['隊長甲', '賽員二', 't1']) {
    const html = render(query);
    assert.match(html, /甲隊/);
    assert.doesNotMatch(html, /沒有符合的參賽者/);
    assert.doesNotMatch(html, /乙隊/);
  }
  assert.match(render('不存在'), /沒有符合的參賽者/);
});

test('round cards remain identical when only final-ranking penalties change', () => {
  const raw = fixture();
  const render = () =>
    renderToStaticMarkup(
      createElement(RoundsView, {
        event: audienceEvent(raw, project(raw)),
        round: 1,
        setPlayerRound: noop,
        setBoard: noop,
        setPerson: noop,
        setRound: noop,
        setSelectedResult: noop,
        setTab: noop,
      }),
    );
  const before = render();
  raw.penalties = { t1: 5, t2: 2 };
  assert.equal(render(), before);
});

test('private board results are scoped to the selected event, board and director role', () => {
  const raw = fixture(),
    event = audienceEvent(raw, project(raw)),
    assignment = raw.assignments[0];
  const result = {
    assignmentId: assignment.id,
    board: 1,
    level: 7,
    strain: 'NT' as const,
    declarer: 'N' as const,
    doubled: 1 as const,
    tricks: 13,
    lead: '',
    nsScore: 1520,
    updatedAt: raw.updatedAt,
  };
  const privateDeal = {
    eventId: event.id,
    board: raw.boards[0],
    results: { [`${assignment.id}:1`]: result },
    pairScores: {},
  };
  const render = (director: boolean, preview = privateDeal) =>
    renderToStaticMarkup(
      createElement(BoardsView, {
        event,
        board: 1,
        director,
        privateDeal: preview,
        previewing: false,
        previewDeal: async () => {},
        awayPerspective: false,
        resultSelection: 0,
        resultSort: 'table-asc',
        selectedResult: '',
        travellerSide: 'ns',
        setAwayPerspective: noop,
        setBoard: noop,
        setPrivateDeal: noop,
        setResultSelection: noop,
        setResultSort: noop,
        setSelectedResult: noop,
        setTravellerSide: noop,
      }),
    );
  const snapshot = structuredClone(event);
  assert.match(render(true), /更新私下成績/);
  assert.doesNotMatch(render(false), /更新私下成績/);
  assert.doesNotMatch(render(true, { ...privateDeal, eventId: 'another-event' }), /更新私下成績/);
  assert.doesNotMatch(render(true, { ...privateDeal, board: raw.boards[1] }), /更新私下成績/);
  assert.deepEqual(event, snapshot, 'preview rendering never writes into the public snapshot');
});

test('publication panel keeps director-only identity and deletion controls out of staff UI', () => {
  const raw = fixture(),
    event = audienceEvent(raw, project(raw));
  const render = (canDirect: boolean, section: 'information' | 'boards' | 'all' = 'all') =>
    renderToStaticMarkup(
      createElement(PublicationPanel, {
        section,
        event: { ...event, canDirect },
        busy: false,
        deleteName: '',
        eventId: event.id,
        onDeleted: async () => {},
        save: async () => true,
        setBusy: noop,
        setDeleteName: noop,
        setError: noop,
      }),
    );
  assert.match(render(true), /儲存賽段資訊/);
  assert.match(render(true, 'information'), /儲存賽段資訊/);
  assert.doesNotMatch(render(true, 'information'), /依牌組公開牌型|永久刪除賽段/);
  assert.match(render(true, 'boards'), /依牌組公開牌型/);
  assert.match(render(true, 'boards'), /永久刪除賽段/);
  assert.doesNotMatch(render(true, 'boards'), /儲存賽段資訊|儲存給獎與賽程說明|結束賽事/);
  assert.doesNotMatch(render(false, 'boards'), /依牌組公開牌型|永久刪除賽段/);
  assert.doesNotMatch(render(false), /儲存賽段資訊|刪除賽段/);
  assert.doesNotMatch(render(true), /賽段狀態|完成覆核並結束賽段/);
});

 test('double winner standings render separate directional tables and search each group', () => {
  const raw = createEvent({name:'Double',kind:'pairs',rankingMode:'double',names:['北甲','北乙','北丙','東甲','東乙','東丙'],boardsPerRound:2,date:'2026-10-18',venue:''});
  const event = audienceEvent(raw, project(raw));
  const render = (query: string) => renderToStaticMarkup(createElement(StandingsView,{event,query,id:event.id,follow:'',setPerson:noop,setQuery:noop,setTab:noop,toggleFollow:noop}));
  const tables=render('').match(/<table[\s\S]*?<\/table>/g)!;
  assert.equal(tables.length,2);
  assert.equal((tables[0].match(/1-3/g) ?? []).length,3);
  assert.equal((tables[1].match(/1-3/g) ?? []).length,3);
  assert.match(tables[0],/南北 NS 排名/);
  assert.match(tables[1],/東西 EW 排名/);
  for (const p of raw.participants) {
    assert.ok(tables[p.group === 'NS' ? 0 : 1].includes(p.name));
    assert.ok(!tables[p.group === 'NS' ? 1 : 0].includes(p.name));
  }
  const filtered=render('北甲');
  assert.match(filtered,/北甲/);
  assert.doesNotMatch(filtered,/北乙/);
  assert.equal((filtered.match(/沒有符合的參賽者/g) ?? []).length,1);
});


test('tied rank ranges use full standings despite search and plain ranks have no leading zero', () => {
  const raw=fixture();
  const event=audienceEvent(raw,project(raw));
  event.projection.standings.forEach((s,i) => {s.rank=i === 0 ? 1 : i === 3 ? 4 : 2;});
  const render=(query:string) => renderToStaticMarkup(createElement(StandingsView,{event,query,id:event.id,follow:'',setPerson:noop,setQuery:noop,setTab:noop,toggleFollow:noop}));
  assert.equal((render('').match(/2-3/g) ?? []).length,2);
  assert.match(render(event.projection.standings[1].name),/2-3/);
  assert.match(render(''),/rank-4[^>]*>4<\/span>/);
  assert.doesNotMatch(render(''),/>04</);
});

function findAction(node: any, label: string): any {
  if (!node || typeof node !== 'object') return undefined;
  const text = (n: any): string => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : '';
  if (node.type === 'button' && text(node.props.children) === label) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const found = findAction(child, label);
    if (found) return found;
  }
}
test('finish-review button submits a valid audited command without a score correction reason', async () => {
  const raw = fixture();
  for (const a of raw.assignments) for (const board of a.boards) {
    raw.results[`${a.id}:${board}`] = {
      assignmentId: a.id, board, level: 3, strain: 'NT', declarer: 'N',
      doubled: 1, tricks: 9, lead: '', nsScore: 400, updatedAt: raw.updatedAt,
    };
  }
  raw.status = 'review';
  const state: StoredEvent = { event: raw, projection: project(raw), requests: [] };
  let updated = state;
  const panel = RoundControlPanel({
    event: { ...audienceEvent(raw, state.projection), canDirect: true },
    busy: false,
    save: async (payload) => {
      const command = mutationSchema.parse({
        ...payload, revision: raw.revision,
        requestId: 'a91bef9c-cbad-43dc-9ed0-9393d70569b4',
        reason: payload.reason ?? '',
      });
      updated = applyMutation(state, command);
      return true;
    },
  });
  const button = findAction(panel, '完成覆核並結束賽段');
  assert.equal(button.props.disabled, false);
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => true } });
  try { await button.props.onClick(); }
  finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
  assert.equal(updated.event.status, 'finished');
  assert.deepEqual(updated.event.results, raw.results);
  assert.equal(updated.event.audit.at(-1)?.reason, '完成覆核並結束賽段');
});
test('match action opens the home team and preserves the selected round', () => {
  const raw = createEvent({name:'導覽測試',kind:'teams',date:'2026-10-20',venue:'',names:['甲','乙','丙','丁'],rounds:2,boardsPerRound:2});
  const event = audienceEvent(raw, project(raw));
  let person = '', selectedRound = 0, tab = '';
  const view = RoundsView({event,round:2,setBoard:()=>{throw new Error('Must not open board view');},setPerson:(v)=>{person=String(v);},setPlayerRound:(v)=>{selectedRound=Number(v);},setRound:noop,setSelectedResult:noop,setTab:(v)=>{tab=String(v);}});
  findAction(view, '本場成績 ').props.onClick();
  assert.equal(person, event.projection.matches.find(m=>m.round===2)!.a);
  assert.equal(selectedRound,2);
  assert.equal(tab,'players');
});

test('team perspective swaps to opponent and back without changing round', () => {
  const raw = fixture(), event = audienceEvent(raw, project(raw));
  const match = event.projection.matches[0];
  let person = match.a;
  const props = {event,playerRound:1,playerSort:'round' as const,setBoard:noop,setPerson:(v:any)=>{person=v;},setPlayerRound:()=>{throw new Error('Round must stay unchanged');},setPlayerSort:noop,setRound:noop,setSelectedResult:noop,setTab:noop,setTravellerSide:noop};
  findAction(PlayersView({...props,person}), '切換視角').props.onClick();
  assert.equal(person,match.b);
  findAction(PlayersView({...props,person}), '切換視角').props.onClick();
  assert.equal(person,match.a);
  const empty = {...event, assignments:[], projection:{...event.projection,matches:[]}};
  assert.equal(findAction(PlayersView({...props,event:empty,person}), '切換視角'),undefined);
});

test('contract Butler display is opt-in and does not remove raw scores or summaries', () => {
  const raw = fixture();
  for (const a of raw.assignments) for (const b of a.boards) raw.results[`${a.id}:${b}`] = {assignmentId:a.id,board:b,level:3,strain:'NT',declarer:'N',doubled:1,tricks:9,lead:'',nsScore:400,updatedAt:raw.updatedAt};
  const event = audienceEvent(raw, project(raw));
  const props = {event,person:event.participants[0].id,playerRound:1,playerSort:'round' as const,setBoard:noop,setPerson:noop,setPlayerRound:noop,setPlayerSort:noop,setRound:noop,setSelectedResult:noop,setTab:noop,setTravellerSide:noop};
  const off = renderToStaticMarkup(createElement(PlayersView, props));
  const on = renderToStaticMarkup(createElement(PlayersView, {...props,showContractButler:true}));
  assert.doesNotMatch(off,/class="muted butler-imp"/);
  assert.match(on,/class="muted butler-imp"/);
  assert.match(off,/aria-checked="false"/);
  assert.match(on,/aria-checked="true"/);
  assert.match(off,/400/);
  assert.match(off.replace(/<[^>]*>/g, ''), /Butler 統計/);
  assert.match(off,/查看賽前與賽後累積 VP/);
  assert.match(off,/賽前 → 賽後/);
  assert.doesNotMatch(off,/player-cumulative-vp/);
  assert.equal((off.match(/popoverTarget="player-vp-scale"/gi) ?? []).length, 2);
  assert.equal((off.match(/popoverTarget="player-butler-summary"/gi) ?? []).length, 2);
  let enabled = false;
  const action = findAction(PlayersView({...props,setShowContractButler:(v)=>{enabled=v;}}),'顯示單副 Butler');
  action.props.onClick();
  assert.equal(enabled,true);
});

test('round VP dialog uses actual match board count and handles pending and BAM scores', () => {
  const raw = fixture(), event = audienceEvent(raw, project(raw));
  const match = {...event.projection.matches[0],total:14,vpA:null,vpB:null};
  const html = renderToStaticMarkup(createElement(MatchVpScale,{event,match}));
  assert.match(html,/14 牌 VP 換算表/);
  assert.match(html,/成績未齊/);
  assert.doesNotMatch(html,/vp-scale-current/);
  const bam = renderToStaticMarkup(createElement(MatchVpScale,{event:{...event,teamMethod:'bam',bam:{win:3,draw:1,loss:0}},match}));
  assert.match(bam,/3／1／0 VP/);
  assert.doesNotMatch(bam,/VP 換算表/);
});
test('ongoing team matches show provisional VP without changing official standings', async () => {
  const { seedEvents } = await import('../lib/domain/demo-events');
  const stored = seedEvents()[0];
  const event = audienceEvent(stored.event, stored.projection);
  const match = event.projection.matches.find((m) => m.completed > 0 && m.completed < m.total)!;
  const before = JSON.stringify(event.projection);
  const html = renderToStaticMarkup(createElement(MatchVpScale, {event, match}));
  assert.match(html, /暫計 VP/);
  assert.match(html, /尚未計入總排名/);
  assert.match(html, /vp-scale-current/);
  const playerProps = {event,person:match.a,playerRound:match.round,playerSort:'round' as const,setBoard:noop,setPerson:noop,setPlayerRound:noop,setPlayerSort:noop,setRound:noop,setSelectedResult:noop,setTab:noop,setTravellerSide:noop};
  const playerHtml = renderToStaticMarkup(createElement(PlayersView, playerProps));
  assert.match(playerHtml, /暫計 VP/);
  assert.match(playerHtml, /vp-scale-current/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(PlayersView, {...playerProps,event:{...event,results:{}}})), /暫計 VP/);
  assert.equal(match.vpA, null);
  assert.equal(JSON.stringify(event.projection), before);
  const empty = renderToStaticMarkup(createElement(MatchVpScale, {event: {...event, results:{}}, match}));
  assert.doesNotMatch(empty, /暫計 VP/);
  const finished = event.projection.matches.find((m) => m.vpA !== null)!;
  assert.doesNotMatch(renderToStaticMarkup(createElement(MatchVpScale, {event, match:finished})), /暫計 VP/);
});
