import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicationPanel } from '../components/admin/PublicationPanel';
import { RoundControlPanel } from '../components/admin/RoundControlPanel';
import { BoardsView } from '../components/scoreboard/BoardsView';
import { MatchVpScale } from '../components/match-vp-scale';
import { PlayersView } from '../components/scoreboard/PlayersView';
import { RoundsView } from '../components/scoreboard/RoundsView';
import { StandingsView } from '../components/scoreboard/StandingsView';
import { audienceEvent } from '../lib/club-view';
import { directionalDatum } from '../lib/datum';
import { applyMutation, createEvent } from '../lib/events';
import { mutationSchema, resultKey, type Mutation, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';

const noop = () => {};

// Hooks must execute inside React; restore globals so other tests stay isolated.
async function withRenderedView(run: (view: {
  render: (element: ReactElement) => Promise<void>;
  button: (label: string) => HTMLButtonElement | undefined;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><div id="test-root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = dom.window.document.getElementById('test-root')!;
  const root = createRoot(container);
  try {
    await run({
      render: async element => { await act(async () => { root.render(element); }); },
      button: label => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(label)),
    });
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

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

function boardViewProps(raw: ReturnType<typeof fixture>) {
  return {
    event: audienceEvent(raw, project(raw)),
    board: 1,
    director: false,
    privateDeal: null,
    previewing: false,
    previewDeal: async () => {},
    awayPerspective: false,
    resultSelection: 0,
    resultSort: 'table-asc',
    selectedResult: '',
    travellerSide: 'ns' as const,
    setAwayPerspective: noop,
    setBoard: noop,
    setPrivateDeal: noop,
    setResultSelection: noop,
    setResultSort: noop,
    setSelectedResult: noop,
    setTravellerSide: noop,
  };
}

// Use the same board across different round numbers to exercise the interleaved traveller.
function teamBoardViewProps(raw: StoredEvent['event'], interleaved: boolean) {
  const props = boardViewProps(raw);
  if (interleaved) {
    props.event = {
      ...props.event,
      teamMovement: 'interleaved',
      assignments: props.event.assignments.map((a) =>
        a.room === 'closed' ? { ...a, round: a.round + 1 } : a,
      ),
    };
  }
  return props;
}

test('team board comparison orders contracts by the first team’s seating direction', async () => {
  const raw = createEvent({
    name: '隊制逐副測試', kind: 'teams', names: ['甲隊', '乙隊'],
    date: '2026-10-18', venue: '', rounds: 1, boardsPerRound: 2,
  });
  const open = raw.assignments.find((a) => a.room === 'open')!;
  const closed = raw.assignments.find((a) => a.room === 'closed')!;
  raw.boards[0].published = true;
  raw.results[resultKey(open.id, 1)] = {
    assignmentId: open.id, board: 1, level: 1, strain: 'NT', declarer: 'W',
    doubled: 1, tricks: 8, lead: '', nsScore: -120, updatedAt: raw.updatedAt,
  };
  raw.results[resultKey(closed.id, 1)] = {
    assignmentId: closed.id, board: 1, level: 3, strain: 'NT', declarer: 'W',
    doubled: 1, tricks: 8, lead: '', nsScore: 100, updatedAt: raw.updatedAt,
  };
  for (const interleaved of [false, true]) {
    const props = teamBoardViewProps(raw, interleaved);
    for (const awayPerspective of [false, true]) {
      const perspectiveProps = { ...props, awayPerspective };
      const html = renderToStaticMarkup(createElement(BoardsView, perspectiveProps));
      const doc = JSDOM.fragment(html);
      assert.equal(doc.querySelector('.board-results h3')!.textContent,
        interleaved ? '跨圈兩桌逐副比較' : '開閉兩室逐副比較');
      assert.deepEqual([...doc.querySelectorAll('.board-results th')].map((cell) => cell.textContent),
        ['對戰', '南北合約', '東西合約', 'IMP']);
      assert.doesNotMatch(doc.querySelector('.board-results')!.textContent!,
        /我方|對方|公開室|關閉室|第一桌|第二桌/);
      const row = doc.querySelector('.board-results tbody tr')!;
      assert.equal(row.querySelector('strong')!.textContent, awayPerspective ? '乙隊' : '甲隊');
      const cells = [...row.querySelectorAll('td[role="button"]')];
      assert.deepEqual(cells.map((cell) => cell.querySelector('.contract')!.textContent?.trim()),
        awayPerspective ? ['3NT 西 -1', '1NT 西 +1'] : ['1NT 西 +1', '3NT 西 -1']);
      assert.deepEqual(cells.map((cell) => cell.querySelector('.team-raw-score')!.firstChild?.textContent),
        awayPerspective ? ['+100', '+120'] : ['-120', '-100']);
      assert.equal(row.lastElementChild!.textContent, awayPerspective ? '+6' : '-6');
      assert.equal(doc.querySelector('.board-results .footnote')!.textContent,
        `目前為${awayPerspective ? '客隊' : '主隊'}視角：南北合約為左欄第一支隊伍坐南北的那一桌，東西合約為該隊坐東西的那一桌。兩桌分數均為該隊實得分數，合計後換算 IMP，正數表示該隊得分。`);

      const [nsTable, ewTable] = awayPerspective ? [closed, open] : [open, closed];
      await withRenderedView(async ({ render }) => {
        const selections: string[] = [];
        await render(createElement(BoardsView, {
          ...perspectiveProps,
          selectedResult: nsTable.id,
          setSelectedResult: (update) => selections.push(typeof update === 'function' ? update('') : update),
        }));
        const row = document.querySelector('.board-results tbody tr')!;
        const [nsCell, ewCell] = [...row.querySelectorAll<HTMLElement>('td[role="button"]')];
        assert.equal(row.getAttribute('aria-pressed'), 'true');
        assert.equal(nsCell.getAttribute('aria-label'), `選取第 ${nsTable.table} 桌南北合約，查看首攻`);
        assert.equal(ewCell.getAttribute('aria-label'), `選取第 ${ewTable.table} 桌東西合約，查看首攻`);
        assert.equal(nsCell.tabIndex, 0);
        assert.equal(ewCell.tabIndex, 0);
        assert.equal(nsCell.getAttribute('aria-pressed'), 'true');
        assert.equal(ewCell.getAttribute('aria-pressed'), 'false');
        await act(async () => {
          nsCell.click();
          ewCell.click();
          nsCell.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          ewCell.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
          row.querySelector('strong')!.click();
        });
        assert.deepEqual(selections, [nsTable.id, ewTable.id, nsTable.id, ewTable.id, nsTable.id]);
      });

      const bam = JSDOM.fragment(renderToStaticMarkup(createElement(BoardsView, {
        ...perspectiveProps,
        event: { ...props.event, teamMethod: 'bam' },
      })));
      assert.deepEqual([...bam.querySelectorAll('.board-results th')].map((cell) => cell.textContent),
        ['對戰', '南北合約', '東西合約', 'VP']);
      assert.equal(bam.querySelector('.board-results .footnote')!.textContent,
        'BAM：以左欄第一支隊伍兩桌實得分數合計比較，依每牌勝／和／負給予 VP。');
    }
  }
});

test('team board comparison shows artificial awards in seat order without raw scores or Butler hints', () => {
  const raw = fixture();
  const closed = raw.assignments.find((a) => a.room === 'closed')!;
  raw.boards[0].published = true;
  for (const a of raw.assignments.filter((a) => a.matchId !== closed.matchId)) {
    raw.results[resultKey(a.id, 1)] = {
      assignmentId: a.id, board: 1, level: 1, strain: 'NT', declarer: 'N',
      doubled: 1, tricks: 7, lead: '', nsScore: 90, updatedAt: raw.updatedAt,
    };
  }
  const { event } = applyMutation(
    { event: raw, projection: project(raw), requests: [] },
    mutationSchema.parse({
      action: 'adjusted-score', revision: raw.revision, requestId: randomUUID(),
      reason: '裁定理由', assignmentId: closed.id, board: 1, award: { ns: 'A+', ew: 'A−' },
    }),
  );
  for (const awayPerspective of [false, true]) {
    for (const teamMethod of ['imp', 'bam'] as const) {
      const props = boardViewProps({ ...event, teamMethod });
      const doc = JSDOM.fragment(renderToStaticMarkup(createElement(BoardsView, {
        ...props, awayPerspective,
      })));
      const rows = [...doc.querySelectorAll('.board-results tbody tr')];
      const row = rows.find((candidate) => candidate.textContent?.includes('調整分'))!;
      const labels = ['調整分 NS A+ / EW A−', '調整分 NS A− / EW A+'];
      assert.deepEqual([...row.querySelectorAll('td[role="button"]')].map((cell) => cell.firstElementChild?.textContent),
        awayPerspective ? labels : labels.toReversed());
      assert.deepEqual([...row.querySelectorAll('.team-raw-score')].map((cell) => cell.textContent), ['—', '—']);
      assert.ok(rows.some((candidate) => candidate !== row && candidate.querySelector('.butler-imp')));
      assert.equal(row.lastElementChild?.textContent, teamMethod === 'bam'
        ? (awayPerspective ? '+2' : '0')
        : (awayPerspective ? '+3' : '-3'));
    }
  }
});

test('team board Butler brackets use the datum in each displayed score’s direction', () => {
  const raw = createEvent({
    name: '隊制 Butler 測試', kind: 'teams',
    names: ['甲隊', '乙隊', '丙隊', '丁隊', '戊隊', '己隊', '庚隊', '辛隊', '壬隊', '癸隊'],
    date: '2026-10-18', venue: '', rounds: 1, boardsPerRound: 2,
  });
  const openScores = [-120, -120, -120, -600, -600];
  const closedScores = [100, -120, -150, 100, -170];
  const openNsImps = [+2, +2, +2, -9, -9];
  const closedNsImps = [+7, +2, +1, +7, 0];
  const open = raw.assignments.filter((a) => a.room === 'open')
    .sort((a, b) => String(a.table).localeCompare(String(b.table), 'en', { numeric: true }));
  assert.equal(open.length, 5);
  raw.boards[0].published = true;
  for (const [i, a] of open.entries()) {
    const closed = raw.assignments.find((c) => c.matchId === a.matchId && c.room === 'closed')!;
    for (const [assignment, nsScore] of [[a, openScores[i]], [closed, closedScores[i]]] as const) {
      raw.results[resultKey(assignment.id, 1)] = {
        assignmentId: assignment.id, board: 1, level: 1, strain: 'NT', declarer: 'W',
        doubled: 1, tricks: 8, lead: '', nsScore, updatedAt: raw.updatedAt,
      };
    }
  }
  const datums = directionalDatum(Object.values(raw.results));
  assert.equal(datums.ns.datum, -180);
  assert.equal(datums.ew.datum, +180);

  for (const interleaved of [false, true]) {
    const props = teamBoardViewProps(raw, interleaved);
    for (const awayPerspective of [false, true]) {
      const doc = JSDOM.fragment(renderToStaticMarkup(createElement(BoardsView, { ...props, awayPerspective })));
      const rows = [...doc.querySelectorAll('.board-results tbody tr')];
      assert.equal(rows.length, 5);
      for (const [i, row] of rows.entries()) {
        const scores = awayPerspective ? [closedScores[i], -openScores[i]] : [openScores[i], -closedScores[i]];
        const brackets = awayPerspective ? [closedNsImps[i], -openNsImps[i]] : [openNsImps[i], -closedNsImps[i]];
        const cells = [...row.querySelectorAll('.team-raw-score')];
        assert.equal(cells.length, 2);
        for (const [column, direction] of (['ns', 'ew'] as const).entries()) {
          const cell = cells[column];
          const hint = cell.querySelector('.butler-imp')!;
          const score = Number(cell.firstChild!.textContent);
          const bracket = Number(hint.textContent!.slice(1, -1));
          assert.equal(score, scores[column]);
          assert.equal(bracket, brackets[column] || 0);
          assert.equal(hint.getAttribute('title'), `Butler IMP（${direction.toUpperCase()} 視角）`);
          const difference = score - datums[direction].datum!;
          // The IMP scale awards zero for differences below 20 points.
          assert.equal(Math.sign(bracket), Math.abs(difference) < 20 ? 0 : Math.sign(difference));
        }
      }
      if (awayPerspective) {
        assert.match(rows[0].querySelectorAll('.team-raw-score')[1].textContent!, /^\+120\(-2\)$/);
      }
    }
  }
});

test('pairs board traveller keeps its directional headings and raw score', () => {
  const raw = createEvent({
    name: '雙人賽介面測試', kind: 'pairs', pairMethod: 'mp', names: ['甲', '乙', '丙', '丁'],
    date: '2026-10-18', venue: '', rounds: 1, boardsPerRound: 2,
  });
  raw.boards[0].published = true;
  for (const assignment of raw.assignments) {
    raw.results[resultKey(assignment.id, 1)] = {
      assignmentId: assignment.id, board: 1, level: 1, strain: 'NT', declarer: 'W',
      doubled: 1, tricks: 8, lead: '', nsScore: -120, updatedAt: raw.updatedAt,
    };
  }
  const doc = JSDOM.fragment(renderToStaticMarkup(createElement(BoardsView, boardViewProps(raw))));
  assert.equal(doc.querySelector('.board-results h3')!.textContent, '單副成績表');
  assert.deepEqual([...doc.querySelectorAll('.board-results th')].map((cell) => cell.textContent),
    ['桌/圈', 'NS / EW', '合約', 'NS 分', 'NS MP%']);
  assert.match(doc.querySelector('.board-results tbody')!.textContent!, /1NT 西 \+1-120/);
  assert.equal(doc.querySelector('.board-results .footnote'), null);
});

test('publication panel keeps director-only identity and deletion controls out of staff UI', () => {
  const raw = fixture(),
    event = audienceEvent(raw, project(raw));
  const render = (canDirect: boolean, section: 'information' | 'boards' | 'all' = 'all', overrides: Partial<Parameters<typeof PublicationPanel>[0]['event']> = {}) =>
    renderToStaticMarkup(
      createElement(PublicationPanel, {
        section,
        event: { ...event, canDirect, ...overrides },
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
  assert.doesNotMatch(render(true, 'information'), /儲存公開時機|永久刪除賽段/);
  const controls = (html: string) => new JSDOM(html).window.document;
  const team = controls(render(true, 'boards'));
  const selects = [...team.querySelectorAll<HTMLSelectElement>('select')];
  assert.deepEqual(selects.map(select => select.name), ['vp', 'contract', 'hands']);
  for (const select of selects) {
    assert.equal(select.value, 'manual');
    assert.deepEqual([...select.options].map(option => option.text), ['手動公開', '一圈打完公開', '兩桌可比即公開']);
  }
  const gridLabels = (doc: Document) =>
    [...doc.querySelectorAll('.publication-grid')].map(grid => grid.previousElementSibling?.textContent);
  assert.deepEqual(gridLabels(team), ['VP', '合約', '牌型']);
  const mixed = controls(render(true, 'boards', { publicTiming: { vp: 'round', contract: 'manual', hands: 'board' } }));
  assert.deepEqual(gridLabels(mixed), ['合約']);
  const pairs = render(true, 'boards', { kind: 'pairs' });
  assert.match(pairs, /依牌組公開牌型/);
  assert.match(pairs, /各桌成績/);
  assert.equal(controls(pairs).querySelectorAll('.publication-grid').length, 1);
  assert.doesNotMatch(render(true, 'boards'), /排名已隨結算/);
  assert.match(render(true, 'boards'), /永久刪除賽段/);
  assert.doesNotMatch(render(true, 'boards'), /儲存賽段資訊|儲存給獎與賽程說明|結束賽事/);
  assert.doesNotMatch(render(false, 'boards'), /儲存公開時機|publication-grid|永久刪除賽段/);
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
  for (const board of raw.boards) board.published = true;
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

test('team perspective swaps to opponent and back without changing round', async () => {
  const raw = fixture(), event = audienceEvent(raw, project(raw));
  const match = event.projection.matches[0];
  let person = match.a;
  const props = {event,playerRound:1,playerSort:'round' as const,setBoard:noop,setPerson:(v:any)=>{person=v;},setPlayerRound:()=>{throw new Error('Round must stay unchanged');},setPlayerSort:noop,setRound:noop,setSelectedResult:noop,setTab:noop,setTravellerSide:noop};
  await withRenderedView(async view => {
    await view.render(createElement(PlayersView, {...props, person}));
    assert.ok(view.button('切換視角'));
    await act(async () => { view.button('切換視角')!.click(); });
    assert.equal(person, match.b);
    await view.render(createElement(PlayersView, {...props, person}));
    await act(async () => { view.button('切換視角')!.click(); });
    assert.equal(person, match.a);
    const empty = {...event, assignments:[], projection:{...event.projection,matches:[]}};
    await view.render(createElement(PlayersView, {...props, event: empty, person}));
    assert.equal(view.button('切換視角'), undefined);
  });
});

test('contract Butler display is opt-in and does not remove raw scores or summaries', async () => {
  const raw = fixture();
  for (const a of raw.assignments) for (const b of a.boards) raw.results[`${a.id}:${b}`] = {assignmentId:a.id,board:b,level:3,strain:'NT',declarer:'N',doubled:1,tricks:9,lead:'',nsScore:400,updatedAt:raw.updatedAt};
  for (const board of raw.boards) board.published = true;
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
  await withRenderedView(async view => {
    const render = () => view.render(createElement(PlayersView, {...props, showContractButler: enabled, setShowContractButler: v => { enabled = v; }}));
    await render();
    assert.equal(view.button('顯示單副 Butler')?.getAttribute('aria-checked'), 'false');
    await act(async () => { view.button('顯示單副 Butler')!.click(); });
    assert.equal(enabled, true);
    await render();
    assert.equal(view.button('顯示單副 Butler')?.getAttribute('aria-checked'), 'true');
    await act(async () => { view.button('顯示單副 Butler')!.click(); });
    assert.equal(enabled, false);
    await render();
    assert.equal(view.button('顯示單副 Butler')?.getAttribute('aria-checked'), 'false');
  });
});

test('round table shows a club submission before east-west confirmation publishes it', () => {
  const raw = createEvent({
    name: '俱樂部收分',
    kind: 'pairs',
    pairMethod: 'crossimp',
    trim: 'none',
    date: '2026-11-17',
    venue: '',
    names: ['甲', '乙', '丙', '丁'],
    rounds: 1,
    boardsPerRound: 2,
  });
  let state: StoredEvent = { event: raw, projection: project(raw), requests: [] };
  const apply = (command: object) => {
    state = applyMutation(state, {
      revision: state.event.revision,
      requestId: `round-count-${state.event.revision}`,
      reason: '測試操作',
      ...command,
    } as Mutation);
  };
  apply({ action: 'club-config', enabled: true });
  state.event.participants.forEach((p, i) =>
    apply({ action: 'club-config', enabled: true, participantId: p.id, tokenHash: String(i + 1).repeat(64) }),
  );
  apply({ action: 'round-control', round: 1, phase: 'playing' });
  const table = state.event.assignments[0];
  apply({
    action: 'club-play',
    round: 1,
    confirm: false,
    tokenHash: state.event.club!.tokens[table.ns],
    result: {
      assignmentId: table.id,
      board: table.boards[0],
      level: 2,
      strain: 'H',
      declarer: 'S',
      doubled: 1,
      tricks: 8,
      lead: 'DK',
    },
  });
  const event = audienceEvent(state.event, state.projection);
  assert.equal(event.results[resultKey(table.id, table.boards[0])], undefined);
  assert.equal(event.enteredBoards?.[table.id], 1);
  assert.equal(JSON.stringify(event).includes('DK'), false);
  const props = {
    event,
    round: 1,
    setBoard: noop,
    setPerson: noop,
    setPlayerRound: noop,
    setRound: noop,
    setSelectedResult: noop,
    setTab: noop,
  };
  const html = renderToStaticMarkup(createElement(RoundsView, props));
  assert.equal(html.match(/1 \/ 2/g)?.length, 1);
  assert.equal(html.match(/0 \/ 2/g)?.length, 1);
  assert.equal(event.receivedByParticipant?.[table.ns], 1);
  assert.equal(event.receivedByParticipant?.[table.ew], 1);
  assert.ok(event.projection.standings.every((row) => row.played === 0 && row.score === 0 && row.secondary === 0));
  const standings = renderToStaticMarkup(createElement(StandingsView, {
    event,
    query: '',
    id: event.id,
    follow: '',
    setPerson: noop,
    setQuery: noop,
    setTab: noop,
    toggleFollow: noop,
  }));
  assert.equal(standings.match(/mono">1 <span class="muted">\/ 2<\/span>/g)?.length, 2);
  assert.equal(standings.match(/mono">0 <span class="muted">\/ 2<\/span>/g)?.length, 2);
  assert.equal(standings.includes('DK'), false);
  const publishedCount = {
    ...event,
    receivedByParticipant: undefined,
    projection: {
      ...event.projection,
      standings: event.projection.standings.map((row) =>
        row.id === table.ns || row.id === table.ew ? { ...row, played: 1 } : row,
      ),
    },
  };
  const standingsFallback = renderToStaticMarkup(createElement(StandingsView, {
    event: publishedCount,
    query: '',
    id: event.id,
    follow: '',
    setPerson: noop,
    setQuery: noop,
    setTab: noop,
    toggleFollow: noop,
  }));
  assert.equal(standingsFallback.match(/mono">1 <span class="muted">\/ 2<\/span>/g)?.length, 2);
  const cached = { ...event, enteredBoards: undefined, results: state.event.results };
  const fallback = renderToStaticMarkup(createElement(RoundsView, { ...props, event: cached }));
  assert.equal(fallback.match(/1 \/ 2/g)?.length, 1);
});

test('round VP dialog uses actual match board count and handles pending and BAM scores', () => {
  const raw = fixture(), event = audienceEvent(raw, project(raw));
  const match = {...event.projection.matches[0],total:14,vpA:null,vpB:null};
  const html = renderToStaticMarkup(createElement(MatchVpScale,{event,match}));
  assert.match(html,/14 牌 VP 換算表/);
  assert.match(html,/成績未齊/);
  assert.doesNotMatch(html,/vp-scale-current/);
  const bam = renderToStaticMarkup(createElement(MatchVpScale,{event:{...event,teamMethod:'bam',bam:{win:3,draw:1,loss:0}},match}));
  assert.match(bam,/3 \/ 1 \/ 0 VP/);
  assert.doesNotMatch(bam,/VP 換算表/);
});
test('ongoing team matches show provisional VP without changing official standings', async () => {
  const { seedEvents } = await import('../lib/domain/demo-events');
  const stored = seedEvents()[0];
  // Leave one board unscored at every table so the match is unfinished without publishing a deal someone has not played.
  const pending = stored.event.assignments.find((a) => a.round === 2)!.boards[0];
  for (const assignment of stored.event.assignments)
    if (assignment.boards.includes(pending)) delete stored.event.results[resultKey(assignment.id, pending)];
  const event = audienceEvent(stored.event, project(stored.event));
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
