import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicationPanel } from '../components/admin/PublicationPanel';
import { BoardsView } from '../components/scoreboard/BoardsView';
import { RoundsView } from '../components/scoreboard/RoundsView';
import { StandingsView } from '../components/scoreboard/StandingsView';
import { audienceEvent } from '../lib/club-view';
import { createEvent } from '../lib/events';
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
  const render = (canDirect: boolean) =>
    renderToStaticMarkup(
      createElement(PublicationPanel, {
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
  assert.doesNotMatch(render(false), /儲存賽段資訊|刪除賽段/);
});
