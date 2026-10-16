'use client';
import { roundLabel } from '@/lib/team-movement';
import { InterleavedRound } from './interleaved-round';
import { displayedBoardNumber,boardRounds as getBoardRounds } from '@/lib/board-navigation';
import {
exportPbn
} from '@/lib/imports';
import type {
Assignment,
PublicEvent,
Result
} from '@/lib/model';
import { resultKey } from '@/lib/model';
import { dateRangeLabel } from '@/lib/date-range';
import { participantNumber } from '@/lib/participant-number';
import { allRoundsComplete,roundProgress } from '@/lib/round-progress';
import { awardedResult,imps,pairStandingsBeforeRound,teamBoardImps,teamStandingsThroughRound,vp } from '@/lib/scoring';
import { tableNames } from '@/lib/table-names';
import {
Activity,
ArrowDownToLine,
ArrowLeft,
ArrowRight,
ChevronDown,
ChevronRight,
ClipboardList,
Eye,
EyeOff,
Flag,
LayoutDashboard,
LoaderCircle,
Search,
Settings2,
Spade,
Star,
Trophy,
Users,
X
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';
import { AdminPanel } from './admin-panel';
import { ManualLink } from './manual-link';
import { Breadcrumbs } from './breadcrumbs';
import { BoardInformation,DealExplorer } from './deal-explorer';
import { Modal } from './event-dialogs';
import { ReviewExport } from './review-export';
import { api,Contract,download,EventSummary,hasDeal,methodNames,number,pairTone,pairValue,signed,Tab } from './scoreboard-shared';
import { DealDiagram,RoundSelect,Stat } from './scoreboard-widgets';
import { SessionControl } from './session-control';
import { TeamButlerPopover } from './team-butler-popover';
export default function Scoreboard() {
  function positionDetail(trigger: HTMLButtonElement) {
    const target = trigger.getAttribute('popovertarget');
    requestAnimationFrame(() => {
      const popup = target ? document.getElementById(target) : null;
      if (!popup || !popup.matches(':popover-open')) return;
      const anchor = trigger.getBoundingClientRect();
      const box = popup.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 8),
      );
      const top =
        anchor.bottom + box.height + 8 <= window.innerHeight
          ? anchor.bottom + 6
          : Math.max(8, anchor.top - box.height - 6);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
    });
  }
  const [resultSort, setResultSort] = useState('table-asc');
  const [playerSort, setPlayerSort] = useState<'round' | 'board' | 'opponent'>('round');
  const [playerRound, setPlayerRound] = useState(1);
  const [travellerSide, setTravellerSide] = useState<'ns' | 'ew'>('ns');
  const [awayPerspective, setAwayPerspective] = useState(false);
  const [selectedResult, setSelectedResult] = useState('');
  const [resultSelection, setResultSelection] = useState(0);
  function chooseResult(id: string) {
    setSelectedResult((current) => (current === id ? '' : id));
    setResultSelection((value) => value + 1);
  }
  function sortHeading(key: 'table' | 'score' | 'points', label: string) {
    const active = resultSort.startsWith(key);
    const descending = resultSort.endsWith('desc');
    return (
      <th aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}>
        <button
          type="button"
          className="traveller-sort"
          onClick={() =>
            setResultSort(
              `${key}-${active ? (descending ? 'asc' : 'desc') : key === 'table' ? 'asc' : 'desc'}`,
            )
          }
        >
          {label}
        </button>
      </th>
    );
  }
  const [events, setEvents] = useState<EventSummary[]>([]),
    [id, setId] = useState(''),
    [event, setEvent] = useState<PublicEvent | null>(null);
  const [tab, setTab] = useState<Tab>('standings'),
    [round, setRound] = useState(1),
    [board, setBoard] = useState(1),
    [person, setPerson] = useState('');
  const [query, setQuery] = useState(''),
    [follow, setFollow] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [admin, setAdmin] = useState(false),
    [configured, setConfigured] = useState(false),
    [mode, setMode] = useState('demo');
  const [director, setDirector] = useState(false);

  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const manualRefreshUntil = useRef(0);
  useEffect(() => {
    if (!refreshCooldown) return;
    const timer = setTimeout(
      () => setRefreshCooldown(false),
      Math.max(0, manualRefreshUntil.current - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [refreshCooldown]);
  const [showPassword, setShowPassword] = useState(false);
  const [dashboardCollapsed, setDashboardCollapsed] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [showLogin, setShowLogin] = useState(false),
    [password, setPassword] = useState(''),
    [loginError, setLoginError] = useState(''),
    [loggingIn, setLoggingIn] = useState(false);
  const requestGeneration = useRef(0),
    firstLoad = useRef(true);
  const refreshList = useCallback(async () => {
    const data = await api<{ events: EventSummary[]; storage: string }>('/api/events');
    setEvents(data.events);
    setMode(data.storage);
    return data.events;
  }, []);
  useEffect(() => {
    Promise.all([
      refreshList(),
      api<{ admin: boolean; director: boolean; configured: boolean; storage: string }>(
        '/api/session',
      ),
    ])
      .then(([list, session]) => {
        setAdmin(session.admin);
        setDirector(session.director);
        setConfigured(session.configured);
        setMode(session.storage);
        const params = new URLSearchParams(location.search),
          requested = params.get('event');
        setId(list.find((e) => e.id === requested)?.id ?? '');
        if (!list.some(e => e.id === requested)) setError('找不到賽事或賽段，請返回賽事入口。');
        const view = params.get('view');
        if (['standings', 'rounds', 'boards', 'players'].includes(view ?? '')) setTab(view as Tab);
        const b = Number(params.get('board'));
        if (Number.isSafeInteger(b) && b > 0) setBoard(b);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    try {
      setFollow(localStorage.getItem('bridge-follow') ?? '');
    } catch {}
  }, [refreshList]);
  const refreshEvent = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      const generation = ++requestGeneration.current;
      const data = await api<PublicEvent>(`/api/events/${encodeURIComponent(id)}`, { signal });
      if (generation === requestGeneration.current) {
        setEvent(data);
        setError('');
      }
    },
    [id],
  );
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setEvent(null);
    setError('');
    setQuery('');
    setPerson('');
    setRound(1);
    if (!firstLoad.current) setBoard(1);
    firstLoad.current = false;
    refreshEvent(controller.signal).catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    return () => {
      controller.abort();
      requestGeneration.current++;
    };
  }, [refreshEvent]);
  useEffect(() => {
    if (!id) return;
    const params = new URLSearchParams({ event: id, view: tab === 'admin' ? 'standings' : tab });
    if (tab === 'boards') params.set('board', String(board));
    history.replaceState(null, '', `?${params}`);
  }, [id, tab, board]);
  useEffect(() => {
    if (!event || event.status === 'finished' || tab === 'admin') return;
    let alive = true,
      timer: ReturnType<typeof setTimeout>,
      failures = 0;
    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) {
        try {
          await refreshEvent();
          failures = 0;
        } catch {
          failures++;
          setError('更新失敗，保留上次成績。連線恢復後會重試。');
        }
      }
      if (alive) timer = setTimeout(tick, Math.min(120000, 30000 * 2 ** failures));
    };
    timer = setTimeout(tick, 30000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [event?.id, event?.status, tab, refreshEvent]);
  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([refreshEvent(), refreshList()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }
  async function manualRefresh() {
    if (refreshing || Date.now() < manualRefreshUntil.current) return;
    manualRefreshUntil.current = Date.now() + 5000;
    setRefreshCooldown(true);
    await refresh();
  }
  function toggleFollow(value: string) {
    const next = follow === value ? '' : value;
    setFollow(next);
    try {
      localStorage.setItem('bridge-follow', next);
    } catch {}
  }
  function openAdmin() {
    setShowPassword(false);
    if (!admin) setShowLogin(true);
    else if (!id && director) location.assign('/');
    else setTab('admin');
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const session = await api<{ director: boolean }>('/api/session', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setAdmin(true);
      setDirector(session.director);
      setPassword('');
      setShowPassword(false);
      setShowLogin(false);
      setTab('admin');
      if (!id && session.director) location.assign('/');
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoggingIn(false);
    }
  }
  const name = (pid: string) => event?.participants.find((p) => p.id === pid)?.name ?? pid;
  const currentProgress = event ? (event.collectionProgress ?? roundProgress(event)) : null;
  const progressRound = currentProgress?.round ?? event?.currentRound ?? 0;
  const competitionComplete = event?.status === 'finished' || !!event && allRoundsComplete(event);
  const receivedResults = Object.values(event?.results ?? {});
  const cancelledResults = receivedResults.filter(result => result.status === 'cancelled').length;
  const validResults = receivedResults.length - cancelledResults;
  const roundOnBreak = event?.roundPhase === 'break' || (!event?.clubEnabled &&
    !!currentProgress?.expected && currentProgress.received === currentProgress.expected);
  const currentTiming = event?.roundTimes?.[progressRound];
  const playerId = person || event?.participants[0]?.id;
  const playerMatch = event?.assignments.find(a => a.round === playerRound && a.room === 'open' && (a.ns === playerId || a.ew === playerId));
  const previousStandings = event?.kind === 'teams' && playerRound > 1 ? teamStandingsThroughRound(event, playerRound - 1) : [];
  let playerBand = 0;
  const playerRows = (event?.assignments ?? [])
    .filter((a) => a.ns === playerId || a.ew === playerId)
    .filter((a) => event?.kind !== 'teams' || a.round === playerRound)
    .flatMap((a) => a.boards.map((b) => ({ a, b })))
    .sort((left, right) => {
      if (playerSort === 'board') return left.b - right.b || left.a.round - right.a.round;
      if (playerSort === 'opponent') {
        const opponent = (a: typeof left.a) => (a.ns === playerId ? a.ew : a.ns);
        const order = opponent(left.a).localeCompare(opponent(right.a), 'en', { numeric: true });
        if (order) return order;
      }
      return left.a.round - right.a.round || left.b - right.b;
    })
    .map((row, index, rows) => {
      if (index > 0 && row.a.round !== rows[index - 1].a.round) playerBand++;
      return { ...row, shaded: playerBand % 2 === 1 };
    });
  const teamPlayerRows = playerRows.filter(({ a }) => a.room === 'open').map(({ a, b }) => {
    const closed = event?.assignments.find(other => other.matchId === a.matchId && other.room === 'closed');
    const openResult = event?.results[resultKey(a.id, b)];
    const closedResult = closed ? event?.results[resultKey(closed.id, b)] : undefined;
    const impDiff = !openResult || !closedResult || openResult.status === 'cancelled' || closedResult.status === 'cancelled'
      ? null
      : openResult.status === 'average' || closedResult.status === 'average'
        ? 0
        : teamBoardImps(openResult, closedResult)[a.ns === playerId ? 0 : 1];
    const scores = (event?.assignments ?? []).filter(other => other.boards.includes(b))
      .map(other => event?.results[resultKey(other.id, b)])
      .filter(result => result && result.status !== 'cancelled' && result.status !== 'average')
      .map(result => result!.nsScore);
    const mean = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
    const datum = mean === null ? null : Math.sign(mean) * Math.round(Math.abs(mean) / 10) * 10;
    const calculateButlers = (opponent = false) => [a, closed].map(assignment => {
      const result = assignment ? event?.results[resultKey(assignment.id, b)] : undefined;
      return result && assignment && result.status !== 'cancelled' && result.status !== 'average' && datum !== null
        ? imps(awardedResult(result, (assignment.ns === playerId) !== opponent ? 'ns' : 'ew')!.nsScore - datum) * ((assignment.ns === playerId) !== opponent ? 1 : -1) : null;
    });
    return { a, b, closed, impDiff, butlers: calculateButlers(), opponentButlers: calculateButlers(true) };
  });
  const playerButlers = teamPlayerRows.flatMap(row => row.butlers).filter((value): value is number => value !== null);
  const opponentButlerTotal = teamPlayerRows.flatMap(row => row.opponentButlers).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const playerButlerTotal = playerButlers.reduce((sum, value) => sum + value, 0);
  const cumulativePlayerStandings = event?.kind === 'teams' ? teamStandingsThroughRound(event, playerRound) : [];
  const playerImpTotal = teamPlayerRows.reduce((total, row) => total + (row.impDiff ?? 0), 0);
  const playerImpFor = teamPlayerRows.reduce((total, row) => total + Math.max(0, row.impDiff ?? 0), 0);
  const playerImpAgainst = teamPlayerRows.reduce((total, row) => total + Math.max(0, -(row.impDiff ?? 0)), 0);
  const playerMatchScore = event?.projection.matches.find(match => match.id === playerMatch?.matchId);
  const playerMatchVp = playerMatchScore
    ? playerMatchScore.a === playerId ? playerMatchScore.vpA : playerMatchScore.vpB
    : null;
  const playerVpBoards = playerMatchScore?.total ?? teamPlayerRows.length;
  const opponentMatchVp = playerMatchScore
    ? playerMatchScore.a === playerId ? playerMatchScore.vpB : playerMatchScore.vpA
    : null;
  const playerVpScale = playerVpBoards > 0
    ? Array.from({ length: Math.ceil(15 * Math.sqrt(playerVpBoards)) + 1 }, (_, margin) => ({
        margin, winner: vp(margin, playerVpBoards), loser: vp(-margin, playerVpBoards),
      }))
    : [];
  const selectedBoard = event?.boards.find((b) => b.number === board) ?? event?.boards[0];
  const boardRounds = event ? getBoardRounds(event) : [];
  const boardRound =
    boardRounds.find((r) => r.boards.includes(selectedBoard?.number ?? 0)) ?? boardRounds[0];
  const boardNumberInRound = boardRound?.boards.indexOf(selectedBoard?.number ?? 0) ?? 0;
  const completedBoardScores =
    event && selectedBoard
      ? event.assignments
          .filter((a) => a.boards.includes(selectedBoard.number))
          .map((a) => event.results[resultKey(a.id, selectedBoard.number)])
          .filter((r) => r && r.status !== 'cancelled' && r.status !== 'average')
          .map((r) => r.nsScore)
      : [];
  const averageBoardScore = completedBoardScores.length
    ? completedBoardScores.reduce((sum, score) => sum + score, 0) / completedBoardScores.length
    : null;
  const pairMethod = event?.pairMethod ?? 'mp';
  const displayBoardNumber = (n: number) => displayedBoardNumber(n, event ?? undefined);
  const butlerDatum = averageBoardScore === null ? null : Math.sign(averageBoardScore) * Math.round(Math.abs(averageBoardScore) / 10) * 10;
  const butlerHint = (r?: Result) => r && r.status !== 'cancelled' && r.status !== 'average' && butlerDatum !== null
    ? <span className="muted butler-imp" title="Butler IMP（NS 視角）">({signed(imps(r.nsScore - butlerDatum))})</span> : null;
  const scoreSide = event?.kind === 'pairs' ? travellerSide : 'ns';
  const sideSign = scoreSide === 'ns' ? 1 : -1;
  const sideLabel = scoreSide.toUpperCase();
  const traveller =
    event && selectedBoard
      ? event.assignments
          .filter((a) => a.boards.includes(selectedBoard.number))
          .sort((a, b) => {
            if (event.kind === 'teams') return String(a.table).localeCompare(String(b.table), 'en', { numeric: true });
            if (resultSort.startsWith('table'))
              return (
                (String(a.table).localeCompare(String(b.table), 'en', { numeric: true }) ||
                  a.round - b.round) * (resultSort.endsWith('desc') ? -1 : 1)
              );
            const value = (assignment: Assignment) => {
              const key = resultKey(assignment.id, selectedBoard.number),
                r = event.results[key];
              if (!r || r.status === 'cancelled') return null;
              if (resultSort.startsWith('points')) {
                const points = event.projection.pairScores[key];
                const score = points?.[scoreSide];
                return score == null
                  ? null
                  : pairMethod === 'mp'
                    ? points.top > 0
                      ? score / points.top
                      : null
                    : score;
              }
              return r.nsScore * sideSign;
            };
            const x = value(a),
              y = value(b);
            return x === null
              ? y === null
                ? 0
                : 1
              : y === null
                ? -1
                : (x - y) * (resultSort.endsWith('desc') ? -1 : 1);
          })
      : [];
  const activeResult = event?.results[resultKey(selectedResult, selectedBoard?.number ?? 0)];
  const activeAssignment = event?.assignments.find(
    (a) => a.id === selectedResult && a.boards.includes(selectedBoard?.number ?? 0),
  );
  const activeNames = event ? tableNames(event.kind, event.participants, activeAssignment) : {};
  const selectedRoundMatches = event?.projection.matches.filter((m) => event.teamMovement === 'interleaved' ? event.assignments.some(a => a.round === round && a.matchId === m.id) : m.round === round) ?? [];
  const playerBye = event?.projection.byes?.find(b => b.round === playerRound && b.participantId === playerId);
  const roundPairStandings = event?.kind === 'pairs' ? pairStandingsBeforeRound(event, round) : [];
  const roundTeamStandings = event?.kind === 'teams' ? teamStandingsThroughRound(event, round) : [];
  function browseBoard(number: number) {
    setSelectedResult('');
    setBoard(number);
  }
  const boardNavigation =
    event && selectedBoard ? (
      <div className={`board-nav board-jump ${event.kind === 'pairs' ? 'pairs-board-jump' : ''}`}>
        <button
          className="icon-button"
          aria-label="上一副"
          disabled={selectedBoard.number <= 1}
          onClick={() => browseBoard(selectedBoard.number - 1)}
        >
          <ArrowLeft size={18} />
        </button>
        <label className="board-number-picker">
          <strong className="board-number" aria-hidden="true">{displayBoardNumber(selectedBoard.number)}</strong>
          <select aria-label="選擇牌號" value={selectedBoard.number}
            onChange={(e) => browseBoard(Number(e.target.value))}>
            {event.kind === 'teams'
              ? boardRounds.map((round) => (
                  <optgroup key={round.round} label={'第 ' + roundLabel(event, round.round) + ' 圈'}>
                    {round.boards.map((number, index) => (
                      <option key={index} value={number}>牌號 {displayBoardNumber(number)}（圈內第 {index + 1} 牌）</option>
                    ))}
                  </optgroup>
                ))
              : event.boards.map((board) => (
                  <option key={board.number} value={board.number}>牌號 {displayBoardNumber(board.number)}</option>
                ))}
          </select>
        </label>
        <button
          className="icon-button"
          aria-label="下一副"
          disabled={selectedBoard.number >= event.boards.length}
          onClick={() => browseBoard(selectedBoard.number + 1)}
        >
          <ArrowRight size={18} />
        </button>
      </div>
    ) : null;
  const navItems: [Tab, string, typeof Trophy][] = [
    ['standings', '總排名', Trophy],
    ['rounds', '圈次與對戰', ClipboardList],
    ['boards', '逐副成績', Spade],
    ['players', event?.kind === 'pairs' ? '搭檔成績' : '隊伍成績', Users],
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="/" className="brand">
          <span className="brand-symbol" aria-hidden="true">♦</span>
          <span>
            <span className="sidebar-wordmark">VALET</span><small>橋牌賽事記分</small>
          </span>
        </a>
        <div className="sidebar-label">賽事工作區</div>
        <a className="workspace-button" href={`/?competition=${encodeURIComponent(event?.competition?.id ?? event?.parentEventId ?? id)}`}>
          <LayoutDashboard size={18} />
          <span>賽事主頁</span>
          <ChevronRight size={15} />
        </a>
        <div className="sidebar-label second">成績查詢</div>
        <nav>
          {navItems.map(([key, label, Icon]) => (
            <button
              key={key}
              className={`nav-item ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              <Icon size={19} />
              {label}
              {key === tab && <span className="active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom"><ManualLink />
          <button className="workspace-button" aria-label={admin && !director ? '賽務功能表' : '裁判功能表'} aria-expanded={tab === 'admin'} onClick={openAdmin}>
            <Settings2 size={18} />
            <span>{admin && !director ? '賽務功能表' : '裁判功能表'}</span>
            <ChevronRight size={15} />
          </button>
          <div className="sidebar-note">
            <span className="tiny-suits">
              ♠ <b>♥ ♦</b> ♣
            </span>
            <p>再怎麼說橋牌還是太 Creepy 了</p>
            <small>Valet</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Breadcrumbs items={event ? [
            { label: event.competition?.name ?? event.name, href: `/?competition=${encodeURIComponent(event.competition?.id ?? event.parentEventId ?? event.id)}` },
            { label: event.stageName ?? '賽事成績' },
          ] : [{ label: '賽事成績' }]} />
          <div className="top-actions">
            {admin ? (
              <SessionControl director={director} onMenu={openAdmin} onLogout={async () => {
                try {
                  await api('/api/session', { method: 'DELETE' });
                  setAdmin(false); setDirector(false); setTab('standings');
                } catch (e) { setError((e as Error).message); }
              }} />
            ) : (
              <button className="session-role session-login" onClick={openAdmin}>
                登入
              </button>
            )}
          </div>
        </header>
        <main>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={refresh}>重新載入</button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
              <button aria-label="關閉訊息" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty">
              <LoaderCircle className="spin" />
              載入賽事中…
            </div>
          ) : (
            <>
              {id && !event && !error && (
                <div className="empty">
                  <LoaderCircle className="spin" />
                  載入成績中…
                </div>
              )}
              {event && (
                <>
                  <section className="event-heading">
                    <div className="event-intro">
                      {event.stageName && <div className="section-kicker">{event.competition?.name ?? event.name}</div>}
                      <h1>
                        <button
                          className="event-title-button"
                          popoverTarget="event-information"
                          onClick={(e) => positionDetail(e.currentTarget)}
                          aria-label="查看比賽資訊"
                        >
                          {(event.stageName ?? event.name).split(/\s+/).map((part, index) => (
                            <span className="event-name-part" key={index}>
                              {index > 0 ? ' ' : ''}
                              {part}
                            </span>
                          ))}
                        </button>
                      </h1>
                      <div
                        id="event-information"
                        key={event.id}
                        popover="auto"
                        className="player-detail-popover event-information"
                      >
                        <strong>{[event.prefix, event.name].filter(Boolean).join(' ')}</strong>
                        <div>日期：{dateRangeLabel(event)}</div>
                        <div>地點：{event.venue || '線上記分'}</div>
                      </div>
                      <div className="event-meta">
                        <span className="event-format">
                          {event.gameMode === 'minibridge' && 'MiniBridge · 無身價 · '}
                          {event.kind === 'teams'
                            ? 'IMP · WBF 20-0 VP'
                            : `${methodNames[pairMethod]} · ${event.participants.every(p => p.group) ? 'NS／EW 分組排名' : '合併排名'} · ${event.trim === 'one' ? '各去一筆' : event.trim === 'ten-percent' ? '各去 10%' : '不去頭尾'}`}
                        </span>
                      </div>
                    </div>
                    <button
                      className={`button subtle ${refreshing ? 'refreshing' : ''}`}
                      disabled={refreshing || refreshCooldown}
                      onClick={manualRefresh}
                    >
                      <Activity size={16} />
                      {refreshing ? '更新中' : '更新成績'}
                    </button>
                  </section>
                  {event.demo && (
                    <div className="demo-banner">
                      <span>範例賽事</span> 使用模擬成績與牌型，供操作展示。
                      {mode === 'demo'
                        ? '目前為唯讀模式。'
                        : '可在後台試填；正式比賽請裁判建立新賽事。'}
                    </div>
                  )}
                  <button
                    className="section-collapse"
                    aria-expanded={!dashboardCollapsed}
                    aria-controls="event-dashboard"
                    onClick={() => setDashboardCollapsed((collapsed) => !collapsed)}
                  >
                    <span>
                      比賽進度
                      {dashboardCollapsed &&
                        (competitionComplete
                          ? ' · 賽事已結束'
                          : progressRound
                            ? ` · 第 ${roundLabel(event, progressRound)}/${roundLabel(event, event.rounds)} 圈${roundOnBreak ? ' · 圈間休息' : ''}`
                            : event.rounds ? ' · 尚未開始' : ' · 待設定賽程')}
                    </span>
                    <ChevronDown size={15} className={dashboardCollapsed ? 'collapsed' : ''} />
                  </button>
                  <div id="event-dashboard" className="stats-grid" hidden={dashboardCollapsed}>
                    <Stat
                      label={event.kind === 'teams' ? '參賽隊伍' : '參賽搭檔'}
                      value={event.participants.length}
                      suffix={event.kind === 'teams' ? '隊' : '對'}
                      icon={<Users />}
                      popoverTarget="award-information"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    />
                    <Stat
                      label="目前圈數"
                      value={roundLabel(event, progressRound)}
                      suffix={`/ ${roundLabel(event, event.rounds)} 圈`}
                      detail={
                        competitionComplete
                          ? '賽事已結束'
                          : !progressRound
                            ? '尚未開始'
                            : roundOnBreak
                              ? '圈間休息'
                              : undefined
                      }
                      icon={<Flag />}
                      popoverTarget="current-round-information"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    />
                    <Stat
                      label="比賽牌數"
                      value={event.boards.length}
                      suffix="副"
                      icon={<Spade />}
                      popoverTarget="movement-information"
                      onClick={(e) => positionDetail(e.currentTarget)}
                      detail={`每圈 ${event.boardsPerRound} 牌`}
                    />
                    <Stat
                      label={competitionComplete ? '有效成績 / 已收成績' : '本圈已收成績'}
                      value={competitionComplete ? validResults : currentProgress?.received ?? 0}
                      suffix={`/ ${competitionComplete ? receivedResults.length : currentProgress?.expected ?? 0} 筆`}
                      progress={
                        competitionComplete
                          ? undefined
                          : currentProgress?.expected
                          ? currentProgress.received / currentProgress.expected
                          : 0
                      }
                      popoverTarget="current-round-progress"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    />
                  </div>
                  <div id="award-information" popover="auto" className="player-detail-popover">
                    <strong>給獎資訊</strong>
                    <div>{(event.awardPlaces ?? 3) === 0 ? '不給獎' : '給獎範圍：前 ' + (event.awardPlaces ?? 3) + ' 名（同分並列）'}</div>
                    <div className="description-text">{event.awardDescription || '尚未公布給獎內容'}</div>
                  </div>
                  <div id="movement-information" popover="auto" className="player-detail-popover">
                    <strong>賽程編排說明</strong>
                    <div className="description-text">{event.movementDescription || '尚未提供詳細說明'}</div>
                    <div>{event.rounds} 圈，每圈 {event.boardsPerRound} 牌；共 {event.boards.length} 副牌。</div>
                    <div>實際對戰、牌組與輪空請見「圈次與對戰」。</div>
                  </div>
                  <div
                    id="current-round-information"
                    key={`time-${event.id}-${event.currentRound}`}
                    popover="auto"
                    className="player-detail-popover"
                  >
                    <strong>
                      {competitionComplete ? '賽事已結束' : progressRound
                        ? `第 ${roundLabel(event, progressRound)} 圈${roundOnBreak ? ' · 圈間休息' : ''}`
                        : '裁判尚未指定目前圈數'}
                    </strong>
                    <div>
                      {currentTiming
                        ? `${new Date(currentTiming.startAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })} — ${new Date(currentTiming.endAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })}（臺灣時間）`
                        : '尚未設定本圈時間區間'}
                    </div>
                  </div>
                  <div
                    id="current-round-progress"
                    key={`progress-${event.id}-${event.currentRound}`}
                    popover="auto"
                    className="player-detail-popover"
                  >
                    {competitionComplete ? (
                      <>
                        <strong>全賽事收分統計</strong>
                        <div>已收成績：{receivedResults.length} 筆</div>
                        <div>有效成績：{validResults} 筆</div>
                        <div>已取消：{cancelledResults} 筆（不計入有效成績）</div>
                      </>
                    ) : !currentProgress?.round ? (
                      '尚未指定目前圈數'
                    ) : !currentProgress.expected ? (
                      '本圈尚未安排賽程'
                    ) : currentProgress.slowest.length === 0 ? (
                      '本圈成績已收齊'
                    ) : (
                      <>
                        <strong>本圈進度最慢桌</strong>
                        {currentProgress.slowest.map(({ assignment, received, expected }) => (
                          <div key={assignment.id}>
                            桌 {assignment.table}
                            {event.teamMovement ? '' : assignment.room === 'open'
                              ? ' · 開室'
                              : assignment.room === 'closed'
                                ? ' · 閉室'
                                : ''}
                            ：{received} / {expected}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="mobile-tabs">
                    {navItems.map(([key, label]) => (
                      <button
                        className={tab === key ? 'selected' : ''}
                        key={key}
                        onClick={() => setTab(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {tab === 'standings' && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h3>
                            總排名{' '}
                            <span className="badge">
                              {competitionComplete ? '最終成績' : '暫定成績'}
                            </span>
                          </h3>
                          <p>
                            {event.kind === 'teams'
                              ? 'VP 計入已完成對戰與已結算輪空；同分並列。'
                              : '依有效結果暫時計分，排名包含罰分計算，同分並列。'}
                          </p>
                        </div>
                        <label className="search">
                          <Search size={17} />
                          <input
                            aria-label="搜尋參賽者"
                            placeholder={event.kind === 'teams' ? '搜尋隊名、隊員或隊長…' : '搜尋姓名或搭檔…'}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="table-scroll">
                        <table className={`ranking-table${event.kind === 'teams' ? ' team-ranking-table' : ''}`}>
                          <thead>
                            <tr>
                              <th className="rank-col">排名</th>
                              {event.participants.some(p => p.group) && <th>組別</th>}
                              <th>{event.kind === 'teams' ? '隊伍' : '搭檔'}</th>
                              <th>完成／安排牌數</th>
                              <th className="score-col">
                                {event.kind === 'teams'
                                  ? '累計 VP'
                                  : pairMethod === 'mp'
                                    ? '總百分比'
                                    : '總 IMP'}
                              </th>
                              <th aria-label="追蹤" />
                            </tr>
                          </thead>
                          <tbody>
                            {event.projection.standings
                              .filter((s) => {
                                const participant = event.kind === 'teams'
                                  ? event.participants.find(p => p.id === s.id)
                                  : undefined;
                                return [s.name, participantNumber(s.id, event.kind), participant?.players, participant?.captain]
                                  .some(value => value?.toLowerCase().includes(query.trim().toLowerCase()));
                              })
                              .map((s) => (
                                <tr
                                  key={s.id}
                                  className={follow === `${id}:${s.id}` ? 'followed' : ''}
                                >
                                  <td>
                                    <span className={`rank rank-${s.rank}`}>
                                      {s.rank <= (event.awardPlaces ?? 3) ? (
                                        <>
                                          <Trophy size={13} />
                                          {s.rank}
                                        </>
                                      ) : (
                                        String(s.rank).padStart(2, '0')
                                      )}
                                    </span>
                                  </td>
                                  {event.participants.some(p => p.group) && <td>{s.group}</td>}
                                  <td>
                                    <button
                                      className="participant-link"
                                      onClick={() => {
                                        setPerson(s.id);
                                        setTab('players');
                                      }}
                                    >
                                      <span>
                                        <span className="standing-name" title={s.name}>{s.name}</span>
                                        <small>
                                          {participantNumber(s.id, event.kind)}{event.kind !== 'teams' && s.players && ` · ${s.players}`}
                                        </small>
                                      </span>
                                    </button>
                                  </td>
                                  <td>
                                    <span className="mono">
                                      {s.played} <span className="muted">/ {s.total}</span>
                                    </span>
                                  </td>
                                  <td className="big-score">
                                    <button
                                      className="contract-link"
                                      popoverTarget={`standing-${s.id}`}
                                      onClick={(e) => positionDetail(e.currentTarget)}
                                      aria-label={`查看 ${s.name} 總分明細`}
                                    >
                                      {number(
                                        s.score,
                                        pairMethod === 'butler' &&
                                          event.kind === 'pairs' &&
                                          Number.isInteger(s.score)
                                          ? 0
                                          : 2,
                                      )}
                                      <small>
                                        {event.kind === 'pairs' && pairMethod === 'mp' ? '%' : ''}
                                      </small>
                                    </button>
                                    <div
                                      id={`standing-${s.id}`}
                                      popover="auto"
                                      className="player-detail-popover"
                                    >
                                      <div>
                                        {event.kind === 'teams'
                                          ? '淨 IMP'
                                          : pairMethod === 'mp'
                                            ? '累計 MP'
                                            : '累計 IMP'}
                                        ：
                                        {number(
                                          s.secondary,
                                          pairMethod === 'butler' && event.kind === 'pairs' ? 0 : 2,
                                        )}
                                      </div>
                                      {event.projection.byes?.filter(b => b.participantId === s.id).map(b => <div key={b.round}>第 {b.round} 圈輪空：{number(b.vp)} VP（{b.awarded ? '已計入' : '待收齊'}）</div>)}
                                      <div>
                                        調整{' '}
                                        {event.kind === 'teams'
                                          ? 'VP'
                                          : pairMethod === 'mp'
                                            ? 'MP'
                                            : 'IMP'}
                                        ：
                                        {number(
                                          s.penalty ?? 0,
                                          pairMethod === 'butler' &&
                                            Number.isInteger(s.penalty ?? 0)
                                            ? 0
                                            : 2,
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                  <td>
                                    <button
                                      className={`icon-button follow-button ${follow === `${id}:${s.id}` ? 'on' : ''}`}
                                      aria-label={`追蹤 ${s.name}`}
                                      aria-pressed={follow === `${id}:${s.id}`}
                                      onClick={() => toggleFollow(`${id}:${s.id}`)}
                                    >
                                      <Star size={17} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                        {!event.projection.standings.some(
                          (s) =>
                            s.name.toLowerCase().includes(query.toLowerCase()) ||
                            participantNumber(s.id, event.kind).toLowerCase().includes(query.toLowerCase()),
                        ) && <div className="empty compact">沒有符合的參賽者</div>}
                      </div>
                      <div className="table-footer">
                        <span>
                          <i className="live-dot" />
                          {event.status === 'finished' ? '賽事已結束' : '成績每 30 秒更新'} · v
                          {event.revision}
                        </span>
                        <span>
                          最後更新{' '}
                          {new Date(event.updatedAt).toLocaleString('zh-TW', {
                            timeZone: 'Asia/Taipei',
                            hour12: false,
                          })}
                        </span>
                      </div>
                    </section>
                  )}
                  {tab === 'rounds' && (
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h3>圈次與對戰</h3>
                          <p>
                            {event.kind === 'teams'
                              ? '查看各圈 IMP 比較與收分進度。'
                              : '查看桌次、南北／東西搭檔與牌組安排。'}
                          </p>
                        </div>
                        <RoundSelect event={event} count={event.rounds} round={round} setRound={setRound} />
                      </div>
                      {event.teamMovement === 'interleaved' && <InterleavedRound event={event} round={round} onBoard={(b, a) => { setBoard(b); setSelectedResult(a); setTab('boards'); }} />}
                      {event.projection.byes?.filter(b => b.round === round).map(b => <p key={b.participantId} className="footnote team-bye-note">{name(b.participantId)}：輪空，{number(b.vp)} VP（{b.awarded ? '已計入排名' : '本圈收分完成後計入'}）。不計 IMP 或實打牌數。</p>)}
                      {event.kind === 'teams' ? (
                        <div className="match-grid">
                          {selectedRoundMatches.map((m) => (
                            <div className="match-card" key={m.id}>
                              <div className="match-meta">
                                {event.teamMovement === 'interleaved' ? `第 ${roundLabel(event, Math.ceil(m.round / 2) * 2 - 1)}–${roundLabel(event, m.round)} 圈比較` : `第 ${event.assignments.find(a => a.matchId === m.id)?.table ?? '—'} 桌`}{' '}
                                <span>
                                  {m.completed === m.total
                                    ? '已收齊'
                                    : `已比對 ${m.completed} / ${m.total} 副`}
                                </span>
                              </div>
                              {[m.a, m.b].map((id, index) => {
                                const standing = roundTeamStandings.find(s => s.id === id);
                                return (
                                  <div className={`match-team ${index === 0 ? 'team-home' : 'team-away'}`} key={id}>
                                    <button className="match-team-link" onClick={() => { setPerson(id); setTab('players'); }}>
                                      <strong>{name(id)}</strong>
                                      <small>{participantNumber(id, event.kind)} / {number(standing?.score ?? null)} VP{standing && ` / #${standing.rank}`}</small>
                                    </button>
                                    <b>{m.split ? `${signed(index === 0 ? m.marginA : m.marginB)} IMP 淨差` : index === 0 ? m.impsA : m.impsB}</b>
                                  </div>
                                );
                              })}
                              <div className="match-bottom">
                                <span>
                                  VP{' '}
                                  <b>
                                    <span className="team-home">{number(m.vpA)}</span> : <span className="team-away">{number(m.vpB)}</span>
                                  </b>
                                </span>
                                <button
                                  onClick={() => {
                                    setBoard(
                                      event.assignments.find((a) => a.matchId === m.id)!.boards[0],
                                    );
                                    setTab('boards');
                                  }}
                                >
                                  逐副比較 <ArrowRight size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="table-scroll">
                          <table className="round-pairs-table">
                            <thead>
                              <tr>
                                <th>桌號</th>
                                <th>南北 NS</th>
                                <th>東西 EW</th>
                                <th>牌號</th>
                                <th>完成</th>
                              </tr>
                            </thead>
                            <tbody>
                              {event.assignments
                                .filter((a) => a.round === round)
                                .map((a) => (
                                  <tr key={a.id}>
                                    <td className="mono">{a.table}</td>
                                    {[a.ns, a.ew].map((id) => {
                                      const standing = roundPairStandings.find(
                                        (s) => s.id === id,
                                      );
                                      const score = standing?.score;
                                      return (
                                        <td key={id}>
                                          <button
                                            className="participant-link"
                                            onClick={() => {
                                              setPerson(id);
                                              setTab('players');
                                            }}
                                          >
                                            <span>
                                              {name(id)}
                                              <small className="round-pair-summary">
                                                {participantNumber(id, event.kind)} /{' '}
                                                {score == null
                                                  ? '—'
                                                  : `${pairMethod !== 'mp' && score >= 0 ? '+' : ''}${number(score, pairMethod === 'butler' && Number.isInteger(score) ? 0 : 2)}${pairMethod === 'mp' ? '%' : ' IMP'}`}
                                                {score != null && standing && ` / #${standing.rank}`}
                                              </small>
                                            </span>
                                          </button>
                                        </td>
                                      );
                                    })}
                                    <td>
                                      <button
                                        className="text-button"
                                        onClick={() => {
                                          setBoard(a.boards[0]);
                                          setTab('boards');
                                        }}
                                      >
                                        {a.boards.length >= 3 &&
                                        a.boards.every(
                                          (b, i) => i === 0 || b === a.boards[i - 1] + 1,
                                        )
                                          ? `${a.boards[0]}-${a.boards[a.boards.length - 1]}`
                                          : a.boards.join(', ')}
                                      </button>
                                    </td>
                                    <td>
                                      {
                                        a.boards.filter((b) => event.results[resultKey(a.id, b)])
                                          .length
                                      }{' '}
                                      / {a.boards.length}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                          <div className="table-footer">
                            {event.assignments.some((a) => a.round === round) ? (
                              <>
                                輪空：
                                {event.participants
                                  .filter(
                                    (p) =>
                                      !event.assignments.some(
                                        (a) =>
                                          a.round === round && (a.ns === p.id || a.ew === p.id),
                                      ),
                                  )
                                  .map((p) => p.name)
                                  .join('、') || '無'}
                              </>
                            ) : (
                              '本圈賽程尚未安排'
                            )}
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                  {tab === 'boards' && selectedBoard && (
                    <>
                      <div className="board-layout">
                        {activeResult?.split && <section className="panel"><div className="panel-heading"><h3>不平衡合約</h3><p className="footnote">下方牌局保留原始紀錄；判罰後各方分別依下列合約計分。</p>{(['ns','ew'] as const).map(side => <p key={side}>{side.toUpperCase()} 獲判：<Contract result={awardedResult(activeResult, side)} /> · <span className="mono">{signed(awardedResult(activeResult, side)!.nsScore * (side === 'ns' ? 1 : -1))}</span></p>)}</div></section>}
                        <section className="panel deal-panel">
                          {hasDeal(selectedBoard) && selectedBoard.deal.N.length === 13 ? (
                            <DealExplorer
                              key={`${event.id}:${selectedBoard.number}`}
                              board={selectedBoard}
                              miniBridge={event.gameMode === 'minibridge'}
                              result={activeResult}
                              playerNames={activeNames}
                              resultSelection={resultSelection}
                              tableSelected={!!activeAssignment}
                              onManualTrial={() => setSelectedResult('')}
                              navigation={boardNavigation}
                              averageScore={
                                averageBoardScore === null ? null : averageBoardScore * sideSign
                              }
                              scoreSide={sideLabel}
                              validResults={completedBoardScores.length}
                            />
                          ) : (
                            <div className="unpublished-board">
                              <BoardInformation
                                number={selectedBoard.number}
                                averageScore={
                                  averageBoardScore === null ? null : averageBoardScore * sideSign
                                }
                                scoreSide={sideLabel}
                                validResults={completedBoardScores.length}
                                navigation={boardNavigation}
                              />
                              <DealDiagram board={selectedBoard} />
                            </div>
                          )}
                          {hasDeal(selectedBoard) && selectedBoard.deal.N.length > 0 && (
                            <div className="board-export-actions">
                            <button
                              className="button subtle"
                              onClick={() =>
                                download(
                                  `board-${selectedBoard.number}.pbn`,
                                  exportPbn({ boards: [selectedBoard] }),
                                )
                              }
                            >
                              <ArrowDownToLine size={15} />
                              下載此副 PBN
                            </button>
                            <ReviewExport board={selectedBoard} />
                            </div>
                          )}
                        </section>
                        <section className="panel board-results">
                          <div className="panel-heading">
                            <div>
                              <h3>{event.kind === 'teams' ? event.teamMovement ? '跨圈兩桌逐副比較' : '開閉兩室逐副比較' : '單副成績表'}</h3>
                            </div>
                            {event.kind === 'teams' && (
                              <button type="button" className="button subtle" aria-pressed={awayPerspective} onClick={() => setAwayPerspective(value => !value)}>
                                {awayPerspective ? '切換主隊視角' : '切換客隊視角'}
                              </button>
                            )}
                          </div>
                          <div className="table-scroll">
                            {event.kind === 'teams' ? (
                              <table>
                                <thead>
                                  <tr>
                                    <th>對戰</th>
                                    <th>我方合約</th>
                                    <th>對方合約</th>
                                    <th>IMP</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {traveller
                                    .filter(
                                      (a) =>
                                        a.room === 'open' &&
                                        a.boards.includes(selectedBoard.number),
                                    )
                                    .map((a) => {
                                      const closed = event.assignments.find(
                                        (c) => c.matchId === a.matchId && c.room === 'closed',
                                      )!;
                                      const x =
                                          event.results[resultKey(a.id, selectedBoard.number)],
                                        y =
                                          event.results[resultKey(closed.id, selectedBoard.number)];
                                      const own = awardedResult(awayPerspective ? y : x, 'ns');
                                      const opponent = awardedResult(awayPerspective ? x : y, 'ew');
                                      const ownTable = awayPerspective ? closed : a;
                                      const opponentTable = awayPerspective ? a : closed;
                                      return (
                                        <tr
                                          key={a.id}
                                          className={
                                            selectedResult === a.id || selectedResult === closed.id
                                              ? 'selected-result selectable-result'
                                              : 'selectable-result'
                                          }
                                          tabIndex={0}
                                          role="button"
                                          aria-pressed={selectedResult === ownTable.id}
                                          onClick={() => chooseResult(ownTable.id)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              chooseResult(ownTable.id);
                                            }
                                          }}
                                          aria-label={`選取第 ${a.table} 桌我方合約`}
                                        >
                                          <td>
                                            <strong className="board-team-name" title={name(awayPerspective ? a.ew : a.ns)}>{name(awayPerspective ? a.ew : a.ns)}</strong>
                                            <small className="block muted board-team-name" title={name(awayPerspective ? a.ns : a.ew)}>vs {name(awayPerspective ? a.ns : a.ew)}</small>
                                          </td>
                                          <td>
                                            <Contract result={own} />
                                            <small className="block mono team-raw-score">
                                              {own?.status === 'average' ? '取消' : own && own.status !== 'cancelled'
                                                ? signed(own.nsScore)
                                                : '—'}
                                              {butlerHint(own)}
                                            </small>
                                          </td>
                                          <td
                                            tabIndex={0}
                                            role="button"
                                            aria-label={`選取第 ${a.table} 桌對方合約，查看首攻`}
                                            aria-pressed={selectedResult === opponentTable.id}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              chooseResult(opponentTable.id);
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                chooseResult(opponentTable.id);
                                              }
                                            }}
                                          >
                                            <Contract result={opponent} />
                                            <small className="block mono team-raw-score">
                                              {opponent?.status === 'average' ? '取消' : opponent && opponent.status !== 'cancelled'
                                                ? signed(opponent.nsScore)
                                                : '—'}
                                              {butlerHint(opponent)}
                                            </small>
                                          </td>
                                          <td className="accent mono">
                                            {x?.status === 'cancelled' || y?.status === 'cancelled'
                                              ? '取消'
                                              : x && y
                                                ? signed(x.status === 'average' || y.status === 'average' ? 0 : teamBoardImps(x, y)[awayPerspective ? 1 : 0])
                                                : '—'}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            ) : (
                              <table>
                                <thead>
                                  <tr>
                                    {sortHeading('table', '桌／圈')}
                                    <th>
                                      <button
                                        type="button"
                                        className="traveller-sort side-switch"
                                        aria-label={`目前 ${sideLabel}，切換為 ${travellerSide === 'ns' ? 'EW' : 'NS'}`}
                                        onClick={() =>
                                          setTravellerSide(travellerSide === 'ns' ? 'ew' : 'ns')
                                        }
                                      >
                                        <span
                                          className={
                                            travellerSide === 'ns' ? 'side-active' : 'side-muted'
                                          }
                                        >
                                          NS
                                        </span>{' '}
                                        /{' '}
                                        <span
                                          className={
                                            travellerSide === 'ew' ? 'side-active' : 'side-muted'
                                          }
                                        >
                                          EW
                                        </span>
                                      </button>
                                    </th>
                                    <th>合約</th>
                                    {sortHeading('score', `${sideLabel} 分`)}
                                    {sortHeading(
                                      'points',
                                      `${sideLabel} ${pairMethod === 'mp' ? 'MP%' : 'IMP'}`,
                                    )}
                                  </tr>
                                </thead>
                                <tbody>
                                  {traveller
                                    .filter((a) => a.boards.includes(selectedBoard.number))
                                    .map((a) => {
                                      const key = resultKey(a.id, selectedBoard.number),
                                        r = event.results[key],
                                        mp = event.projection.pairScores[key];
                                      return (
                                        <tr
                                          key={a.id}
                                          className={
                                            selectedResult === a.id
                                              ? 'selected-result selectable-result'
                                              : 'selectable-result'
                                          }
                                          tabIndex={0}
                                          role="button"
                                          aria-label={`選取第 ${a.table} 桌，查看首攻`}
                                          aria-pressed={selectedResult === a.id}
                                          onClick={() => chooseResult(a.id)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                              e.preventDefault();
                                              chooseResult(a.id);
                                            }
                                          }}
                                        >
                                          <td className="table-round">
                                            {a.table} <small className="muted">/ R{roundLabel(event, a.round)}</small>
                                          </td>
                                          <td>
                                            <span
                                              className={`block ${travellerSide === 'ns' ? 'side-active' : 'side-muted'}`}
                                            >
                                              {name(a.ns)}
                                            </span>
                                            <span
                                              className={`block ${travellerSide === 'ew' ? 'side-active' : 'side-muted'}`}
                                            >
                                              {name(a.ew)}
                                            </span>
                                          </td>
                                          <td>
                                            <Contract result={r} />
                                          </td>
                                          <td className="mono">
                                            {r && r.status !== 'cancelled'
                                              ? signed(r.nsScore * sideSign)
                                              : '—'}
                                          </td>
                                          <td
                                            className={`mono ${pairTone(mp?.[travellerSide], mp?.top ?? 0, pairMethod)}`}
                                          >
                                            {pairValue(
                                              mp?.[travellerSide],
                                              mp?.top ?? 0,
                                              pairMethod,
                                            )}
                                            {mp?.provisional && (
                                              <small className="block muted">暫定</small>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            )}
                          </div>
                          {event.kind === 'teams' && (
                            <p className="footnote">
                              {awayPerspective
                                ? '目前為客隊視角：IMP 以左列第一支隊伍為正，閉室 NS 分減去開室 NS 分後換算。'
                                : '目前為主隊視角：IMP 以左列第一支隊伍為正，開室 NS 分減去閉室 NS 分後換算。'}
                            </p>
                          )}
                        </section>
                      </div>
                    </>
                  )}
                  {tab === 'players' && (
                    <section className="panel player-results">
                      <div className="panel-heading">
                        <div className="team-result-intro">
                          <div>
                          <h3>{event.kind === 'teams' ? '隊伍' : '搭檔'}個別成績</h3>
                          {event.kind === 'teams' && event.participants.find(p => p.id === (person || event.participants[0].id))?.captain && (
                            <p>隊長：{event.participants.find(p => p.id === (person || event.participants[0].id))?.captain}</p>
                          )}
                          {event.kind === 'teams' && event.participants.find(p => p.id === (person || event.participants[0].id))?.players && (
                            <p>隊員：{event.participants.find(p => p.id === (person || event.participants[0].id))?.players}</p>
                          )}
                          </div>
                          {event.kind === 'teams' && <TeamButlerPopover event={event} teamId={person || event.participants[0].id} />}
                        </div>
                        <div className={`player-result-filters${event.kind === 'teams' ? '' : ' pairs-result-filters'}`}>
                        <div className="participant-picker">
                          查看{event.kind === 'teams' ? '隊伍' : '搭檔'}
                          <button
                            className="participant-picker-trigger"
                            aria-label="選擇參賽者"
                            popoverTarget="participant-options"
                            onClick={(e) => positionDetail(e.currentTarget)}
                          >
                            <span><span className="participant-picker-number">{participantNumber((person || event.participants[0].id), event.kind)}</span>{event.kind === 'pairs' ? name(person || event.participants[0].id).trim().replace(/\s+/g, ' ') : name(person || event.participants[0].id)}</span>
                            <ChevronDown size={16} />
                          </button>
                          <div
                            id="participant-options"
                            popover="auto"
                            className="player-detail-popover participant-options"
                          >
                            {event.participants.map((p) => (
                              <button
                                type="button"
                                key={p.id}
                                aria-pressed={p.id === (person || event.participants[0].id)}
                                onClick={(e) => {
                                  setPerson(p.id);
                                  (
                                    e.currentTarget.closest('[popover]') as HTMLElement
                                  )?.hidePopover();
                                }}
                              >
                                <span><span className="participant-picker-number">{participantNumber(p.id, event.kind)}</span>{event.kind === 'pairs' ? p.name.trim().replace(/\s+/g, ' ') : p.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        {event.kind === 'teams' && <label className="participant-picker">
                          查看圈次
                          <select aria-label="選擇成績圈次" value={playerRound} onChange={e => setPlayerRound(Number(e.target.value))}>
                            {Array.from({ length: event.rounds }, (_, i) => <option key={i + 1} value={i + 1}>第 {roundLabel(event, i + 1)} 圈</option>)}
                          </select>
                        </label>}
                        </div>
                        {event.kind === 'teams' && !event.teamMovement && <div className="player-round-context">
                          {playerMatch ? <>
                            <button
                              type="button"
                              className="contract-link"
                              popoverTarget="player-preround-summary"
                              onClick={e => positionDetail(e.currentTarget)}
                            >第 {playerMatch.table} 桌 · 對手：{name(playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns)}</button>
                            <div
                              key={`${playerId}-${playerRound}`}
                              id="player-preround-summary"
                              popover="auto"
                              className="player-detail-popover"
                            >
                            <small>{playerRound === 1 ? '賽前' : `截至第 ${roundLabel(event, playerRound - 1)} 圈`}</small>
                            {[playerId!, playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns].map((id, i) => {
                              const standing = previousStandings.find(s => s.id === id);
                              return <div key={id}>{i === 0 ? '我方' : '對手'}：{playerRound === 1 ? '0.00 VP · 尚無排名' : `${number(standing?.score ?? null)} VP · #${standing?.rank ?? '—'}`}</div>;
                            })}
                            </div>
                          </> : <div>{playerBye ? `本圈輪空：${number(playerBye.vp)} VP（${playerBye.awarded ? '已計入排名' : '待本圈收分完成'}），不計 IMP 或實打牌數。` : '本圈無對戰安排'}</div>}
                        </div>}
                      </div>
                      <div className="table-scroll">
                        {event.teamMovement === 'interleaved' && <InterleavedRound event={event} round={playerRound} teamId={playerId} onBoard={(b, a) => { setBoard(b); setSelectedResult(a); setTab('boards'); }} />}
                        {event.kind === 'teams' && !event.teamMovement && !playerBye && <table className="team-player-results">
                          <thead><tr><th>牌號</th><th>公開</th><th>關閉</th><th>IMP 差</th></tr></thead>
                          <tbody>
                            {teamPlayerRows.map(({ a, b, closed, impDiff, butlers }) => {
                              const openBoard = (assignment?: Assignment) => {
                                setSelectedResult(assignment?.id ?? '');
                                setBoard(b);
                                setTab('boards');
                              };
                              return <tr key={`${a.matchId}-${b}`}>
                                <td><button className="text-button" onClick={() => openBoard(a)}>{displayBoardNumber(b)}</button></td>
                                {[a, closed].map((assignment, index) => {
                                  const result = assignment ? awardedResult(event.results[resultKey(assignment.id, b)], assignment.ns === playerId ? 'ns' : 'ew') : undefined;
                                  const ownScore = result && assignment ? result.nsScore * (assignment.ns === playerId ? 1 : -1) : null;
                                  const butler = butlers[index];
                                  return <td key={index}>
                                    <button className="contract-link" aria-label={`查看牌號 ${displayBoardNumber(b)} ${index === 0 ? '公開' : '關閉'}室成績`} onClick={() => openBoard(assignment)}>
                                      <Contract result={result} />

                                      <small className="block mono team-raw-score">{result?.status === 'average' ? '取消' : result?.status === 'cancelled' || ownScore === null ? '—' : signed(ownScore)}
                                        {butler !== null && <span className="muted butler-imp" title="Butler IMP（我方視角）" aria-label={`Butler IMP ${signed(butler)}`}>({signed(butler)})</span>}
                                      </small>
                                    </button>
                                  </td>;
                                })}
                                <td className="mono">{impDiff === null ? '—' : signed(impDiff)}</td>
                              </tr>;
                            })}
                          </tbody>
                          <tfoot><tr>
                            <td colSpan={4}>
                              <div className="team-match-summary" aria-label="本圈比數，我方在左、對手在右">
                                <span className="muted">{playerMatchScore?.split ? 'IMP 淨差' : 'IMP 合計'}</span>
                                <button type="button" className="contract-link mono" aria-label="查看本圈雙方 Butler IMP" popoverTarget="player-butler-summary" onClick={e => positionDetail(e.currentTarget)}>{teamPlayerRows.some(row => row.impDiff !== null) ? playerMatchScore?.split ? `${signed(playerMatchScore.a === playerId ? playerMatchScore.marginA : playerMatchScore.marginB)} : ${signed(playerMatchScore.a === playerId ? playerMatchScore.marginB : playerMatchScore.marginA)}` : `${playerImpFor} : ${playerImpAgainst}` : '— : —'}</button>
                              <button type="button" className="contract-link" popoverTarget="player-vp-scale" onClick={e => positionDetail(e.currentTarget)}>換算 VP</button>
                                <button type="button" className="contract-link mono" aria-label="查看雙方累積 VP" popoverTarget="player-cumulative-vp" onClick={e => positionDetail(e.currentTarget)}>{number(playerMatchVp)} : {number(opponentMatchVp)}</button>
                              </div>
                              <div key={`${playerId}-${playerRound}-cumulative`} id="player-cumulative-vp" popover="auto" className="player-detail-popover">
                                <strong>截至第 {roundLabel(event, playerRound)} 圈 · 累積 VP</strong>
                                {[playerId, playerMatch ? (playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns) : undefined].map((id, index) => <div key={index}>
                                  {index === 0 ? '我方' : '對手'} · {id ? name(id) : '—'}：<span className="mono">{number(cumulativePlayerStandings.find(s => s.id === id)?.score ?? null)} VP</span>
                                </div>)}
                                <small className="muted">計入已完成對戰與已結算輪空的 VP。</small>
                              </div>
                              <div key={`${playerId}-${playerRound}-butler`} id="player-butler-summary" popover="auto" className="player-detail-popover">
                                <strong>第 {roundLabel(event, playerRound)} 圈 · Butler IMP 合計</strong>
                                <div>我方 · {name(playerId!)}：<span className="butler-total">{playerButlers.length ? signed(playerButlerTotal) : '—'}</span></div>
                                <div>對手 · {playerMatch ? name(playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns) : '—'}：<span className="butler-total">{playerButlers.length ? signed(opponentButlerTotal) : '—'}</span></div>
                                <small className="muted">加總本圈兩室已收的有效成績；取消牌不計入。</small>
                              </div>
                              <div key={`${playerId}-${playerRound}-${playerVpBoards}`} id="player-vp-scale" popover="auto" className="player-detail-popover vp-scale-popover">
                                <strong>第 {roundLabel(event, playerRound)} 圈 · {playerVpBoards} 牌 VP 換算表</strong>
                                <p>WBF 20–0 · 依原訂牌數換算</p>
                                <p>{playerMatchVp === null ? '成績未齊，尚未換算 VP' : `我方 ${signed(playerImpTotal)} IMP → ${number(playerMatchVp)} VP`}</p>
                                {playerVpScale.length ? <div className="vp-scale-scroll">
                                  <table aria-label={`${playerVpBoards} 牌 VP 換算表`}>
                                    <thead><tr><th>IMP 差</th><th>勝方 VP</th><th>負方 VP</th></tr></thead>
                                    <tbody>{playerVpScale.map((entry, index) => <tr key={entry.margin} className={playerMatchVp !== null && Math.min(Math.abs(playerImpTotal), playerVpScale.length - 1) === entry.margin ? 'vp-scale-current' : undefined}>
                                      <td>{entry.margin}{index === playerVpScale.length - 1 ? '+' : ''}</td>
                                      <td>{number(entry.winner)}</td><td>{number(entry.loser)}</td>
                                    </tr>)}</tbody>
                                  </table>
                                </div> : <p>本圈沒有可計分的牌。</p>}
                              </div>
                            </td>
                          </tr></tfoot>
                        </table>}
                        {Boolean(event.kind !== 'teams') && <table>
                          <thead>
                            <tr>
                              {event.kind !== 'teams' && <th aria-sort={playerSort === 'round' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('round')}
                                >
                                  桌次
                                </button>
                              </th>}
                              <th aria-sort={playerSort === 'board' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('board')}
                                >
                                  牌號
                                </button>
                              </th>
                              <th>{event.kind === 'teams' ? '房間' : '方向'}</th>
                              {event.kind !== 'teams' && <th aria-sort={playerSort === 'opponent' ? 'ascending' : 'none'}>
                                <button
                                  className="contract-link"
                                  onClick={() => setPlayerSort('opponent')}
                                >
                                  對手
                                </button>
                              </th>}
                              <th>合約</th>
                              <th>己方原始分</th>
                              {event.kind === 'pairs' && <th>{pairMethod === 'mp' ? 'MP%' : 'IMP'}</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {playerRows.map(({ a, b, shaded }) => {
                              const r = event.results[resultKey(a.id, b)],
                                ns = a.ns === (person || event.participants[0].id),
                                mp = event.projection.pairScores[resultKey(a.id, b)],
                                value = mp ? (ns ? mp.ns : mp.ew) : null;
                              const scores = event.assignments
                                .filter((other) => other.boards.includes(b))
                                .map((other) => event.results[resultKey(other.id, b)])
                                .filter((result) => result && result.status !== 'cancelled')
                                .map((result) => result.nsScore);
                              const average = scores.length
                                ? (scores.reduce((sum, score) => sum + score, 0) / scores.length) *
                                  (ns ? 1 : -1)
                                : null;
                              const popupId = `player-${a.id}-${b}`;
                              const openBoard = () => {
                                setSelectedResult('');
                                setTravellerSide(ns ? 'ns' : 'ew');
                                setBoard(b);
                                setTab('boards');
                              };
                              return (
                                <tr
                                  key={resultKey(a.id, b)}
                                  className={shaded ? 'even-round' : undefined}
                                >
                                  {event.kind !== 'teams' && <td>
                                    <button
                                      className="contract-link"
                                      onClick={() => {
                                        setRound(a.round);
                                        setTab('rounds');
                                      }}
                                    >
                                      <strong className="player-round">R{roundLabel(event, a.round)}</strong>
                                      <small className="muted">/{a.table}</small>
                                    </button>
                                  </td>}
                                  <td>
                                    <button className="text-button" onClick={openBoard}>
                                      {b}
                                    </button>
                                  </td>
                                  <td>{event.kind === 'teams' ? (a.room === 'open' ? '公開' : '關閉') : (ns ? 'NS' : 'EW')}</td>
                                  {event.kind !== 'teams' && <td>
                                    <span className="opponent-name">
                                      {name(ns ? a.ew : a.ns)}{' '}
                                      <small className="muted">
                                        {participantNumber((ns ? a.ew : a.ns), event.kind)}
                                      </small>
                                    </span>
                                    <button
                                      className="opponent-number contract-link"
                                      popoverTarget={`${popupId}-opponent`}
                                      onClick={(e) => positionDetail(e.currentTarget)}
                                    >
                                      {participantNumber((ns ? a.ew : a.ns), event.kind)}
                                    </button>
                                    <div
                                      id={`${popupId}-opponent`}
                                      popover="auto"
                                      className="player-detail-popover"
                                    >
                                      對手：{participantNumber((ns ? a.ew : a.ns), event.kind)} ·{' '}
                                      {name(ns ? a.ew : a.ns)}
                                    </div>
                                  </td>}
                                  <td>
                                    <button
                                      type="button"
                                      className="contract-link"
                                      aria-label={`查看牌號 ${b} 的逐副成績`}
                                      onClick={openBoard}
                                    >
                                      <Contract result={r} />
                                    </button>
                                  </td>
                                  <td className="mono">
                                    <button
                                      className="player-raw-score contract-link"
                                      popoverTarget={`${popupId}-average`}
                                      onClick={(e) => positionDetail(e.currentTarget)}
                                    >
                                      {r && r.status !== 'cancelled'
                                        ? signed(r.nsScore * (ns ? 1 : -1))
                                        : '—'}
                                    </button>
                                    <div
                                      id={`${popupId}-average`}
                                      popover="auto"
                                      className="player-detail-popover"
                                    >
                                      牌號 {b} · {ns ? 'NS' : 'EW'} 平均分{' '}
                                      {average === null
                                        ? '—'
                                        : `${average >= 0 ? '+' : ''}${number(average)}`}
                                      （{scores.length} 桌有效結果）
                                    </div>
                                  </td>
                                  {event.kind === 'pairs' && <td
                                    className={
                                      event.kind === 'pairs'
                                        ? `player-points ${pairTone(value, mp?.top ?? 0, pairMethod)}`
                                        : undefined
                                    }
                                  >
                                    <span className="player-points-value">
                                      {value !== null && mp
                                          ? pairValue(value, mp.top, pairMethod)
                                          : '—'}
                                    </span>
                                  </td>}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>}
                      </div>
                    </section>
                  )}
                  {tab === 'admin' && admin && (
                    <AdminPanel
                      key={id}
                      eventId={id}
                      onSaved={async (message) => {
                        setNotice(message);
                        await refresh();
                      }}
                      onDeleted={async () => {
                        requestGeneration.current++;
                        setEvent(null);
                        location.assign(event.parentEventId ? `/?competition=${encodeURIComponent(event.parentEventId)}` : '/');
                        setTab('standings');
                        setNotice('賽事已刪除。');
                      }}
                    />
                  )}
                  <footer className="page-footer">
                    <span>
                      VALET <span>／</span> 由臺灣大學橋藝社自主研發
                    </span>
                    <span>
                      {event.kind === 'teams' ? 'IMP · WBF VP' : methodNames[pairMethod]}　♠ ♥ ♦ ♣
                    </span>
                  </footer>
                </>
              )}
            </>
          )}
        </main>
      </div>
      {showLogin && (
        <Modal title="裁判／賽務登入" onClose={() => setShowLogin(false)}>
          <p className="muted">
            賽務可更正、取消及判罰；裁判另可建立、刪除、匯入匯出賽事及查看操作紀錄。
          </p>
          {!configured && (
            <div className="alert">
              尚未設定登入。請依 README 設定 ADMIN_PASSWORD 與 SESSION_SECRET；本機可執行 npm run
              dev:local。
            </div>
          )}
          <form onSubmit={login}>
            <label className="field">
              裁判／賽務密碼
              <span className="password-input">
                <input
                  autoFocus
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {loginError && (
              <p className="error-text" role="alert">
                {loginError}
              </p>
            )}
            <button disabled={!configured || loggingIn} className="button primary full">
              {loggingIn ? '登入中…' : '登入後台'}
            </button>
          </form>
        </Modal>
      )}

    </div>
  );
}
