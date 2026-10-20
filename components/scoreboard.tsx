'use client';
import { SuitSymbol } from './suit-symbol';
import { teamScoringLabel } from '@/lib/team-method';
import { followedParticipant, followStorageKey } from '@/lib/followed-participant';
import { resultsSelection } from '@/lib/scoreboard-link';
import { awardRangeDescription } from '@/lib/awards';
import { AppVersion } from './app-version';

import { dateRangeLabel } from '@/lib/date-range';
import { allRoundsComplete, roundProgress } from '@/lib/round-progress';
import { roundLabel } from '@/lib/team-movement';
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  Flag,
  LayoutDashboard,
  LoaderCircle,
  Settings2,
  Spade,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminPanel } from './admin-panel';
import { Breadcrumbs } from './breadcrumbs';
import { Modal } from './event-dialogs';
import { ManualLink } from './manual-link';
import { api, EventSummary, methodNames, Tab } from './scoreboard-shared';
import { Stat } from './scoreboard-widgets';
import { BoardsView } from './scoreboard/BoardsView';
import { PlayersView } from './scoreboard/PlayersView';
import { RoundsView } from './scoreboard/RoundsView';
import { StandingsView } from './scoreboard/StandingsView';
import { useEventResource } from './scoreboard/use-event-resource';
import { usePrivatePreview } from './scoreboard/use-private-preview';
import { SessionControl } from './session-control';

function CurrentTaipeiTime({ active }: { active: boolean }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <div>
      當前時間：<time className="mono" dateTime={now?.toISOString()}>
        {now ? now.toLocaleTimeString('zh-TW', {
          timeZone: 'Asia/Taipei', hour12: false,
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }) : '—'}
      </time>（臺灣時間）
    </div>
  );
}

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
  const [showContractButler, setShowContractButler] = useState(false);
  const [roundInformationOpen, setRoundInformationOpen] = useState(false);
  const [travellerSide, setTravellerSide] = useState<'ns' | 'ew'>('ns');
  const [awayPerspective, setAwayPerspective] = useState(false);
  const [selectedResult, setSelectedResult] = useState('');
  const [resultSelection, setResultSelection] = useState(0);
  const [events, setEvents] = useState<EventSummary[]>([]),
    [id, setId] = useState('');
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
  const { privateDeal, setPrivateDeal, previewing, previewDeal } = usePrivatePreview(
    id,
    board,
    director,
    tab,
    setError,
  );
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
  const { event, setEvent, requestGeneration, refreshEvent } = useEventResource(id, tab, setError, events.find((entry) => entry.id === id));
  const firstLoad = useRef(true);
  const requestedResults = useRef<URLSearchParams | null>(null);
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
        requestedResults.current = params;
        setId(list.find((e) => e.id === requested)?.id ?? '');
        if (!list.some((e) => e.id === requested)) setError('找不到賽事或賽段，請返回賽事入口。');
        const view = params.get('view');
        if (['standings', 'rounds', 'boards', 'players'].includes(view ?? '')) setTab(view as Tab);
        const b = Number(params.get('board'));
        if (Number.isSafeInteger(b) && b > 0) setBoard(b);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refreshList]);
  useEffect(() => {
    const syncFollow = () => {
      try { setFollow(localStorage.getItem(followStorageKey) ?? ''); } catch {}
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === followStorageKey || event.key === null) syncFollow();
    };
    syncFollow();
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', syncFollow);
    window.addEventListener('focus', syncFollow);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', syncFollow);
      window.removeEventListener('focus', syncFollow);
    };
  }, []);
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
    if (!event || event.id !== id || !requestedResults.current) return;
    const selection = resultsSelection(requestedResults.current, event);
    requestedResults.current = null;
    if (selection) {
      setPerson(selection.person);
      setPlayerRound(selection.round);
    }
  }, [event, id]);
  useEffect(() => {
    if (!id) return;
    const params = new URLSearchParams({ event: id, view: tab === 'admin' ? 'standings' : tab });
    if (tab === 'boards') params.set('board', String(board));
    if (tab === 'players') {
      if (person) params.set('person', person);
      params.set('round', String(playerRound));
    }
    const currentParams = new URLSearchParams(location.search);
    const commentHash = tab === 'boards' && currentParams.get('event') === id &&
      currentParams.get('board') === String(board) && location.hash.startsWith('#comment-')
      ? location.hash : '';
    history.replaceState(null, '', `?${params}${commentHash}`);
  }, [id, tab, board, person, playerRound]);
  async function refresh() {
    setRefreshing(true);
    try {
      await refreshList();
      await refreshEvent(undefined, true);
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
      localStorage.setItem(followStorageKey, next);
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
  const currentProgress = event ? (event.collectionProgress ?? roundProgress(event)) : null;
  const progressRound = currentProgress?.round ?? event?.currentRound ?? 0;
  const competitionComplete = !!event && (event.status !== 'live' || allRoundsComplete(event));
  const receivedResults = Object.values(event?.results ?? {});
  const cancelledResults = receivedResults.filter((result) => result.status === 'cancelled').length;
  const validResults = receivedResults.length - cancelledResults;
  const roundOnBreak =
    event?.roundPhase === 'break' ||
    (!event?.clubEnabled &&
      !!currentProgress?.expected &&
      currentProgress.received === currentProgress.expected);
  const currentTiming = event?.roundTimes?.[progressRound];
  const selectedBoard = event?.boards.find((b) => b.number === board) ?? event?.boards[0];
  const pairMethod = event?.pairMethod ?? 'mp';
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
          <span className="brand-symbol" aria-hidden="true">
            ♦
          </span>
          <span>
            <span className="sidebar-wordmark">VALET</span>
            <small>橋牌賽事記分</small>
          </span>
        </a>
        <div className="sidebar-label">賽事工作區</div>
        <a
          className="workspace-button"
          href={`/?competition=${encodeURIComponent(event?.competition?.id ?? event?.parentEventId ?? id)}`}
        >
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
        <div className="sidebar-bottom">
          <ManualLink />
          <button
            className="workspace-button"
            aria-label={admin && !director ? '賽務功能表' : '裁判功能表'}
            aria-expanded={tab === 'admin'}
            onClick={openAdmin}
          >
            <Settings2 size={18} />
            <span>{admin && !director ? '賽務功能表' : '裁判功能表'}</span>
            <ChevronRight size={15} />
          </button>
          <div className="sidebar-note">
            <span className="tiny-suits">
              <span data-suit="S"><SuitSymbol suit="S" /></span> <b><span data-suit="H"><SuitSymbol suit="H" /></span> <span data-suit="D"><SuitSymbol suit="D" /></span></b> <span data-suit="C"><SuitSymbol suit="C" /></span>
            </span>
            <p>比賽不浪費白紙，環保從臺大開始</p>
            <small>
              <AppVersion />
            </small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Breadcrumbs
            items={
              event
                ? [
                    {
                      label: event.competition?.name ?? event.name,
                      href: `/?competition=${encodeURIComponent(event.competition?.id ?? event.parentEventId ?? event.id)}`,
                    },
                    { label: event.stageName ?? '賽事成績' },
                  ]
                : [{ label: '賽事成績' }]
            }
          />
          <div className="top-actions">
            {admin ? (
              <SessionControl
                director={director}
                onMenu={openAdmin}
                onLogout={async () => {
                  try {
                    await api('/api/session', { method: 'DELETE' });
                    setAdmin(false);
                    setDirector(false);
                    if (event?.competition?.archived) { setEvent(null); location.assign('/'); return; }
                    setTab('standings');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              />
            ) : (
              <button className="hub-session" onClick={openAdmin}>
                賽事管理
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
                      {event.stageName && (
                        <div className="section-kicker">
                          {event.competition?.name ?? event.name}
                        </div>
                      )}
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
                        <strong>
                          {[
                            event.competition?.prefix ?? event.prefix,
                            event.competition?.name ?? event.name,
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        </strong>
                        <div>日期：{dateRangeLabel(event)}</div>
                        <div>地點：{event.venue || '線上記分'}</div>
                      </div>
                      <div className="event-meta">
                        <span className="event-format">
                          {event.gameMode === 'minibridge' && '迷你橋牌 · 無身價 · '}
                          {event.kind === 'teams'
                            ? teamScoringLabel(event)
                            : `${methodNames[pairMethod]} · ${event.participants.every((p) => p.group) ? 'NS／EW 分組排名' : '合併排名'} · ${event.trim === 'one' ? '各去一筆' : event.trim === 'ten-percent' ? '各去 10%' : '不去頭尾'}`}
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
                          ? ` · ${event.status === 'finished' ? '賽段已結束' : '成績覆核中'}`
                          : progressRound
                            ? ` · 第 ${roundLabel(event, progressRound)}/${roundLabel(event, event.rounds)} 圈${roundOnBreak ? ' · 圈間休息' : ''}`
                            : event.rounds
                              ? ' · 尚未開始'
                              : ' · 待設定賽程')}
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
                          ? (event.status === 'finished' ? '賽段已結束' : '成績覆核中')
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
                      value={competitionComplete ? validResults : (currentProgress?.received ?? 0)}
                      suffix={`/ ${competitionComplete ? receivedResults.length : (currentProgress?.expected ?? 0)} 筆`}
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
                    <div>
                      {awardRangeDescription(event)}
                    </div>
                    <div className="description-text">
                      {event.awardDescription || '尚未公布給獎內容'}
                    </div>
                  </div>
                  <div id="movement-information" popover="auto" className="player-detail-popover">
                    <strong>賽程編排說明</strong>
                    <div className="description-text">
                      {event.movementDescription || '尚未提供詳細說明'}
                    </div>
                    <div>
                      {event.rounds} 圈，每圈 {event.boardsPerRound} 牌；共 {event.boards.length}{' '}
                      副牌。
                    </div>
                    <div>實際對戰、牌組與輪空請見「圈次與對戰」。</div>
                  </div>
                  <div
                    id="current-round-information"
                    key={`time-${event.id}-${event.currentRound}`}
                    popover="auto"
                    className="player-detail-popover"
                    onToggle={(e) => setRoundInformationOpen(e.newState === 'open')}
                  >
                    <strong>
                      {event.status === 'finished'
                        ? '賽段摘要'
                        : competitionComplete
                          ? '成績覆核中'
                          : progressRound
                            ? `第 ${roundLabel(event, progressRound)} 圈${roundOnBreak ? ' · 圈間休息' : ''}`
                            : '比賽尚未開始'}
                    </strong>
                    {event.status === 'finished' ? (
                      <>
                        <div>已完成 {roundLabel(event, event.rounds)} 圈 · 共 {event.boards.length} 副牌</div>
                        <div className="muted">成績已定案，不再接受更正。</div>
                      </>
                    ) : (
                      <>
                        {!progressRound ? (
                          !competitionComplete && event.roundTimes?.[1] ? (
                            <div>預計於 {new Date(event.roundTimes[1].startAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })} 開始</div>
                          ) : null
                        ) : (
                          <div>
                            {currentTiming
                              ? `${new Date(currentTiming.startAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })} — ${new Date(currentTiming.endAt).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit' })}（臺灣時間）`
                              : '尚未設定本圈時間區間'}
                          </div>
                        )}
                        <CurrentTaipeiTime active={roundInformationOpen} />
                      </>
                    )}
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
                            {event.teamMovement
                              ? ''
                              : assignment.room === 'open'
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
                    <StandingsView
                      event={event}
                      follow={follow}
                      id={id}
                      query={query}
                      setPerson={setPerson}
                      setQuery={setQuery}
                      setTab={setTab}
                      toggleFollow={toggleFollow}
                    />
                  )}
                  {tab === 'rounds' && (
                    <RoundsView
                      event={event}
                      round={round}
                      setBoard={setBoard}
                      setPerson={setPerson}
                      setPlayerRound={setPlayerRound}
                      setRound={setRound}
                      setSelectedResult={setSelectedResult}
                      setTab={setTab}
                    />
                  )}
                  {tab === 'boards' && selectedBoard && (
                    <BoardsView
                      awayPerspective={awayPerspective}
                      board={board}
                      director={director}
                      event={event}
                      previewDeal={previewDeal}
                      previewing={previewing}
                      privateDeal={privateDeal}
                      resultSelection={resultSelection}
                      resultSort={resultSort}
                      selectedResult={selectedResult}
                      setAwayPerspective={setAwayPerspective}
                      setBoard={setBoard}
                      setPrivateDeal={setPrivateDeal}
                      setResultSelection={setResultSelection}
                      setResultSort={setResultSort}
                      setSelectedResult={setSelectedResult}
                      setTravellerSide={setTravellerSide}
                      travellerSide={travellerSide}
                    />
                  )}
                  {tab === 'players' && (
                    <PlayersView
                      showContractButler={showContractButler}
                      setShowContractButler={setShowContractButler}
                      event={event}
                      person={person || followedParticipant(follow, id, event.participants)}
                      playerRound={playerRound}
                      playerSort={playerSort}
                      setBoard={setBoard}
                      setPerson={setPerson}
                      setPlayerRound={setPlayerRound}
                      setPlayerSort={setPlayerSort}
                      setRound={setRound}
                      setSelectedResult={setSelectedResult}
                      setTab={setTab}
                      setTravellerSide={setTravellerSide}
                    />
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
                        location.assign(
                          `/?competition=${encodeURIComponent(event.competition?.id ?? event.parentEventId ?? event.id)}`,
                        );
                        setTab('standings');
                        setNotice('賽段已刪除。');
                      }}
                    />
                  )}
                  <footer className="page-footer">
                    <span>
                      <AppVersion /> <span>／</span> 由臺灣大學橋藝社自主研發
                    </span>
                    <span>
                      {event.kind === 'teams' ? teamScoringLabel(event) : methodNames[pairMethod]}　♠ ♥ ♦ ♣
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
