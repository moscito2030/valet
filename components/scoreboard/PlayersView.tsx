import { useState } from 'react';
import { PairScoreValue } from '../score-value';
import { TeamImpColumns } from '../team-imp-columns';
import { displayedBoardNumber } from '@/lib/board-navigation';
import { directionalDatum } from '@/lib/datum';
import type { Assignment, PublicEvent } from '@/lib/model';
import { resultKey } from '@/lib/model';
import { participantNumber } from '@/lib/participant-number';
import { awardedResult, imps, teamBoardPoints, teamStandingsThroughRound, vp } from '@/lib/scoring';
import { isInterleaved, roundLabel } from '@/lib/team-movement';
import { ChevronDown } from 'lucide-react';
import { InterleavedRound } from '../interleaved-round';
import { Contract, number, pairTone, signed, Tab } from '../scoreboard-shared';
import { TeamButlerPopover } from '../team-butler-popover';
import { PairScoreChart } from './PairScoreChart';

type Props = {
  showContractButler?: boolean;
  setShowContractButler?: (show: boolean) => void;
  event: PublicEvent;
  person: string;
  playerRound: number;
  playerSort: 'board' | 'round' | 'opponent';
  setBoard: React.Dispatch<React.SetStateAction<number>>;
  setPerson: React.Dispatch<React.SetStateAction<string>>;
  setPlayerRound: React.Dispatch<React.SetStateAction<number>>;
  setPlayerSort: React.Dispatch<React.SetStateAction<'board' | 'round' | 'opponent'>>;
  setRound: React.Dispatch<React.SetStateAction<number>>;
  setSelectedResult: React.Dispatch<React.SetStateAction<string>>;
  setTab: React.Dispatch<React.SetStateAction<Tab>>;
  setTravellerSide: React.Dispatch<React.SetStateAction<'ns' | 'ew'>>;
};
export function PlayersView({
  showContractButler = false,
  setShowContractButler,
  event,
  person,
  playerRound,
  playerSort,
  setBoard,
  setPerson,
  setPlayerRound,
  setPlayerSort,
  setRound,
  setSelectedResult,
  setTab,
  setTravellerSide,
}: Props) {
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
      const scroller = popup.querySelector<HTMLElement>('.vp-scale-scroll');
      const current = popup.querySelector<HTMLElement>('.vp-scale-current');
      if (scroller) {
        scroller.scrollTop = current
          ? scroller.scrollTop + current.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            (scroller.clientHeight - current.offsetHeight) / 2
          : 0;
      }
    });
  }
  const name = (pid: string) => event?.participants.find((p) => p.id === pid)?.name ?? pid;
  const playerId = person || event?.participants[0]?.id;
  const [hoveredRow, setHoveredRow] = useState<{ playerId: string; board: number } | null>(null);
  const playerMatch = event?.assignments.find(
    (a) => a.round === playerRound && a.room === 'open' && (a.ns === playerId || a.ew === playerId),
  );
  const previousStandings =
    event?.kind === 'teams' && playerRound > 1
      ? teamStandingsThroughRound(event, playerRound - 1)
      : [];
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
  const teamPlayerRows = playerRows
    .filter(({ a }) => a.room === 'open')
    .map(({ a, b }) => {
      const closed = event?.assignments.find(
        (other) => other.matchId === a.matchId && other.room === 'closed',
      );
      const openResult = event?.results[resultKey(a.id, b)];
      const closedResult = closed ? event?.results[resultKey(closed.id, b)] : undefined;
      const impDiff =
        !openResult ||
        !closedResult ||
        openResult.status === 'cancelled' ||
        closedResult.status === 'cancelled'
          ? null
          : openResult.status === 'average' || closedResult.status === 'average'
            ? 0
            : teamBoardPoints(openResult, closedResult, event)[a.ns === playerId ? 0 : 1];
      const scores = (event?.assignments ?? [])
        .filter(
          (other) =>
            other.boards.includes(b) &&
            (isInterleaved(event!.assignments) || other.round === a.round),
        )
        .map((other) => event?.results[resultKey(other.id, b)])
        .filter((result) => result && result.status !== 'cancelled' && result.status !== 'average')
        .map((result) => result!);
      const datums = directionalDatum(scores);
      const calculateButlers = (opponent = false) =>
        [a, closed].map((assignment) => {
          const result = assignment ? event?.results[resultKey(assignment.id, b)] : undefined;
          return result &&
            assignment &&
            result.status !== 'cancelled' &&
            result.status !== 'average' &&
            datums.ns.datum !== null
            ? (assignment.ns === playerId) !== opponent
              ? imps(awardedResult(result, 'ns')!.nsScore - datums.ns.datum!)
              : imps(-awardedResult(result, 'ew')!.nsScore - datums.ew.datum!)
            : null;
        });
      return {
        a,
        b,
        closed,
        impDiff,
        datums,
        butlers: calculateButlers(),
        opponentButlers: calculateButlers(true),
      };
    });
  const playerButlers = teamPlayerRows
    .flatMap((row) => row.butlers)
    .filter((value): value is number => value !== null);
  const opponentButlerTotal = teamPlayerRows
    .flatMap((row) => row.opponentButlers)
    .reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const playerButlerTotal = playerButlers.reduce((sum, value) => sum + value, 0);
  const cumulativePlayerStandings =
    event?.kind === 'teams' ? teamStandingsThroughRound(event, playerRound) : [];
  const playerImpTotal = teamPlayerRows.reduce((total, row) => total + (row.impDiff ?? 0), 0);
  const playerImpFor = teamPlayerRows.reduce(
    (total, row) => total + Math.max(0, row.impDiff ?? 0),
    0,
  );
  const playerImpAgainst = teamPlayerRows.reduce(
    (total, row) => total + Math.max(0, -(row.impDiff ?? 0)),
    0,
  );
  const playerMatchScore = event?.projection.matches.find(
    (match) => match.id === playerMatch?.matchId,
  );
  const provisionalVp = !!playerMatchScore &&
    (playerMatchScore.vpA === null || playerMatchScore.vpB === null) &&
    playerMatchScore.completed < playerMatchScore.total && playerMatchScore.total > 0 &&
    teamPlayerRows.some(({ a, b, closed }) => closed && [a, closed].every((assignment) => {
      const result = event.results[resultKey(assignment.id, b)];
      return result && result.status !== 'cancelled' && result.status !== 'average';
    }));
  const vpA = playerMatchScore && provisionalVp
    ? event.teamMethod === 'bam' ? playerMatchScore.bamA ?? 0 : vp(playerMatchScore.marginA, playerMatchScore.total)
    : playerMatchScore?.vpA ?? null;
  const vpB = playerMatchScore && provisionalVp
    ? event.teamMethod === 'bam' ? playerMatchScore.bamB ?? 0 : vp(playerMatchScore.marginB, playerMatchScore.total)
    : playerMatchScore?.vpB ?? null;
  const playerMatchVp = playerMatchScore
    ? playerMatchScore.a === playerId
      ? vpA
      : vpB
    : null;
  const playerVpBoards = playerMatchScore?.total ?? teamPlayerRows.length;
  const opponentMatchVp = playerMatchScore
    ? playerMatchScore.a === playerId
      ? vpB
      : vpA
    : null;
  const playerVpScale =
    event.teamMethod !== 'bam' && playerVpBoards > 0
      ? Array.from({ length: Math.ceil(15 * Math.sqrt(playerVpBoards)) + 1 }, (_, margin) => ({
          margin,
          winner: vp(margin, playerVpBoards),
          loser: vp(-margin, playerVpBoards),
        }))
      : [];
  const pairMethod = event?.pairMethod ?? 'mp';
  const displayBoardNumber = (n: number) => displayedBoardNumber(n, event ?? undefined);
  const playerBye = event?.projection.byes?.find(
    (b) => b.round === playerRound && b.participantId === playerId,
  );

  const participantPicker = (id: string) => (
<div className="participant-picker">
            <span className="participant-picker-label">查看{event.kind === 'teams' ? '隊伍' : '搭檔'}</span>
            <button
              className="participant-picker-trigger"
              aria-label="選擇參賽者"
              popoverTarget={id}
              onClick={(e) => positionDetail(e.currentTarget)}
            >
              <span>
                <span className="participant-picker-number">
                  {participantNumber(person || event.participants[0].id, event.kind)}
                </span>
                {event.kind === 'pairs'
                  ? name(person || event.participants[0].id)
                      .trim()
                      .replace(/\s+/g, ' ')
                  : name(person || event.participants[0].id)}
              </span>
              <ChevronDown size={16} />
            </button>
            <div
              id={id}
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
                    (e.currentTarget.closest('[popover]') as HTMLElement)?.hidePopover();
                  }}
                >
                  <span>
                    <span className="participant-picker-number">
                      {participantNumber(p.id, event.kind)}
                    </span>
                    {event.kind === 'pairs' ? p.name.trim().replace(/\s+/g, ' ') : p.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
  );

  return (
    <div className="player-results-view">
    <div className="player-results-layout">
    {event.kind === 'pairs' && <section className="panel pair-picker-panel" aria-label="查看搭檔">{participantPicker('participant-options-wide')}</section>}
    <section className="panel player-results" aria-label={event.kind === 'teams' ? '隊伍個別成績' : '搭檔個別成績'}>
      {event.kind === 'pairs' && <div className="panel-heading pair-results-mobile-heading"><h3>搭檔個別成績</h3><div className="player-result-filters pairs-result-filters">{participantPicker('participant-options-mobile')}</div></div>}
      {event.kind === 'teams' && <div className="panel-heading team-results-heading">
        <div className="team-result-intro">
          <div>
            <div className="team-result-title-row">
              <h3>{event.kind === 'teams' ? '隊伍' : '搭檔'}個別成績</h3>
              {event.kind === 'teams' && <span className="team-result-title-action"><span className="muted" aria-hidden="true">·</span><TeamButlerPopover event={event} teamId={playerId} inline /></span>}
            </div>
          </div>
          {event.kind === 'teams' && !event.teamMovement && (
            <button type="button" className="butler-display-toggle" role="switch" aria-checked={showContractButler} onClick={() => setShowContractButler?.(!showContractButler)}>
              <span className="butler-toggle-track" aria-hidden="true"><span /></span>
              顯示單副 Butler
            </button>
          )}
        </div>
        <div
          className={`player-result-filters${event.kind === 'teams' ? '' : ' pairs-result-filters'}`}
        >
          {event.kind === 'teams' && participantPicker('participant-options-teams')}
          {event.kind === 'teams' && (
            <label className="participant-picker">
              查看圈次
              <select
                aria-label="選擇成績圈次"
                value={playerRound}
                onChange={(e) => setPlayerRound(Number(e.target.value))}
              >
                {Array.from({ length: event.rounds }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    第 {roundLabel(event, i + 1)} 圈
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {event.kind === 'teams' && !event.teamMovement && (
          <div className="player-round-context">
            {playerMatch ? (
              <>
                <button
                  type="button"
                  className="match-context-trigger"
                  title="查看賽前與賽後累積 VP" popoverTarget="player-preround-summary"
                  onClick={(e) => positionDetail(e.currentTarget)}
                >
                  <span className="match-context-label">第 {playerMatch.table} 桌</span>
                  <span className="match-context-separator" aria-hidden="true">·</span>
                  <span className="match-context-opponent">對手 {name(playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns)}</span>
                </button>
                <span className="match-perspective-action">
                  <span className="muted" aria-hidden="true">·</span>
                  <button type="button" className="team-perspective-switch" onClick={() => setPerson(playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns)}>
                    切換視角
                  </button>
                </span>
                <div
                  key={`${playerId}-${playerRound}`}
                  id="player-preround-summary"
                  popover="auto"
                  className="player-detail-popover"
                >
                  <strong>第 {roundLabel(event, playerRound)} 圈 · 累積 VP</strong>
                  <p>賽前 → {playerMatchScore?.vpA != null ? '賽後' : '目前已結算'}</p>
                  {[playerId!, playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns].map(
                    (id, i) => {
                      const standing = previousStandings.find((s) => s.id === id);
                      const after = cumulativePlayerStandings.find((s) => s.id === id);
                      return (
                        <div key={id}>
                          {i === 0 ? '我方' : '對手'} · {name(id)}：
                          <span className="mono">{number(playerRound === 1 ? 0 : standing?.score ?? null)} → {number(after?.score ?? null)} VP</span>
                        </div>
                      );
                    },
                  )}
                  <small className="muted">計入已完成對戰與已結算輪空的 VP。</small>
                </div>
              </>
            ) : (
              <div>
                {playerBye
                  ? `本圈輪空：${number(playerBye.vp)} VP（${playerBye.awarded ? '已計入排名' : '待本圈收分完成'}），不計 IMP 或實打牌數。`
                  : '本圈無對戰安排'}
              </div>
            )}
          </div>
        )}
      </div>
      }
      <div className="table-scroll">
        {event.teamMovement === 'interleaved' && (
          <InterleavedRound
            event={event}
            round={playerRound}
            teamId={playerId}
            onSwapTeam={setPerson}
            onBoard={(b, a) => {
              setBoard(b);
              setSelectedResult(a);
              setTab('boards');
            }}
          />
        )}
        {event.kind === 'teams' && !event.teamMovement && !playerBye && (
          <table className="team-player-results">
            <thead>
              <tr>
                <th>牌號</th>
                <th>公開</th>
                <th>關閉</th>
                <th>{event.teamMethod === 'bam' ? 'VP' : 'IMP'}</th>
              </tr>
            </thead>
            <tbody>
              {teamPlayerRows.map(({ a, b, closed, impDiff, butlers, datums }) => {
                const averageId = `team-board-average-${a.id}-${b}`;
                const openBoard = (assignment?: Assignment) => {
                  setSelectedResult(assignment?.id ?? '');
                  setBoard(b);
                  setTab('boards');
                };
                return (
                  <tr key={`${a.matchId}-${b}`}>
                    <td>
                      <button className="text-button" title="查看牌局" onClick={() => openBoard(a)}>
                        {displayBoardNumber(b)}
                      </button>
                    </td>
                    {[a, closed].map((assignment, index) => {
                      const result = assignment
                        ? awardedResult(
                            event.results[resultKey(assignment.id, b)],
                            assignment.ns === playerId ? 'ns' : 'ew',
                          )
                        : undefined;
                      const ownScore =
                        result && assignment
                          ? result.nsScore * (assignment.ns === playerId ? 1 : -1)
                          : null;
                      const butler = butlers[index];
                      return (
                        <td key={index}>
                          <button
                            className="contract-link"
                            aria-label={`查看牌號 ${displayBoardNumber(b)} ${index === 0 ? '公開' : '關閉'}室成績`}
                            title="查看牌局" onClick={() => openBoard(assignment)}
                          >
                            <Contract result={result} />

                            <small className="block mono team-raw-score">
                              {result?.status === 'average'
                                ? '取消'
                                : result?.status === 'cancelled' || ownScore === null
                                  ? '—'
                                  : signed(ownScore)}
                              {showContractButler && butler !== null && (
                                <span
                                  className="muted butler-imp"
                                  title="Butler IMP（我方視角）"
                                  aria-label={`Butler IMP ${signed(butler)}`}
                                >
                                  ({signed(butler)})
                                </span>
                              )}
                            </small>
                          </button>
                        </td>
                      );
                    })}
                    <td>
                      {event.teamMethod === 'bam' ? <button type="button" className="contract-link team-imp-average-trigger"
                        title="查看本牌 Datum" aria-label={`查看牌號 ${displayBoardNumber(b)} Datum`}
                        popoverTarget={averageId} onClick={(e) => positionDetail(e.currentTarget)}>
                        {impDiff === null ? '—' : signed(impDiff)}
                      </button> : <TeamImpColumns value={impDiff} renderSide={(content, side) => (
                        <button type="button" className="contract-link team-imp-average-trigger"
                          title="查看本牌 Datum" aria-label={`查看牌號 ${displayBoardNumber(b)} Datum（${side === 0 ? '我方' : '對手'} IMP）`}
                          popoverTarget={averageId} onClick={(e) => positionDetail(e.currentTarget)}>
                          {content}
                        </button>
                      )} />}
                      <div id={averageId} popover="auto" className="player-detail-popover datum-popover">
                        <strong>牌號 {displayBoardNumber(b)} · Datum</strong>
                        {(['ns', 'ew'] as const).map((side) => <div key={side}>
                          {side === 'ns' ? '南北 NS' : '東西 EW'}：<span className="mono">{datums[side].datum === null ? '—' : signed(datums[side].datum)}</span>
                        </div>)}
                        <small className="muted">{datums.valid} 桌有效結果</small>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>
                  <div className="team-match-summary" aria-label="本圈比數，我方在左、對手在右">
                    <button
                      type="button"
                      className="contract-link"
                      title="查看本圈雙方 Butler IMP" popoverTarget="player-butler-summary"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    >
                      {event.teamMethod === 'bam' ? 'BAM VP 合計' : playerMatchScore?.split ? 'IMP 淨差' : 'IMP 合計'}
                    </button>
                    <button
                      type="button"
                      className="contract-link mono"
                      aria-label="查看本圈雙方 Butler IMP"
                      title="查看本圈雙方 Butler IMP" popoverTarget="player-butler-summary"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    >
                      {(teamPlayerRows.some((row) => row.impDiff !== null)
                        ? event.teamMethod === 'bam' ? `${number(playerMatchScore?.a === playerId ? playerMatchScore?.bamA ?? null : playerMatchScore?.bamB ?? null)} : ${number(playerMatchScore?.a === playerId ? playerMatchScore?.bamB ?? null : playerMatchScore?.bamA ?? null)}` : playerMatchScore?.split
                          ? `${signed(playerMatchScore.a === playerId ? playerMatchScore.marginA : playerMatchScore.marginB)} : ${signed(playerMatchScore.a === playerId ? playerMatchScore.marginB : playerMatchScore.marginA)}`
                          : `${playerImpFor} : ${playerImpAgainst}`
                        : '— : —').split(' : ').map((value, index) => <span key={index}>{value}</span>)}
                    </button>
                    <button
                      type="button"
                      className="contract-link"
                      title={event.teamMethod === 'bam' ? '查看 BAM 計分規則' : '查看 VP 換算表'} popoverTarget="player-vp-scale"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    >
                      {provisionalVp ? '暫計 VP' : event.teamMethod === 'bam' ? '計分規則' : '換算 VP'}
                    </button>
                    <button
                      type="button"
                      className="contract-link mono"
                      aria-label={event.teamMethod === 'bam' ? '查看 BAM 計分規則' : '查看 VP 換算表'}
                      title={event.teamMethod === 'bam' ? '查看 BAM 計分規則' : '查看 VP 換算表'} popoverTarget="player-vp-scale"
                      onClick={(e) => positionDetail(e.currentTarget)}
                    >
                      <span>{number(playerMatchVp)}</span><span>{number(opponentMatchVp)}</span>
                    </button>
                  </div>
                  <div
                    key={`${playerId}-${playerRound}-butler`}
                    id="player-butler-summary"
                    popover="auto"
                    className="player-detail-popover"
                  >
                    <strong>第 {roundLabel(event, playerRound)} 圈 · Butler IMP 合計</strong>
                    <div>
                      我方 · {name(playerId!)}：
                      <span className="butler-total">
                        {playerButlers.length ? signed(playerButlerTotal) : '—'}
                      </span>
                    </div>
                    <div>
                      對手 ·{' '}
                      {playerMatch
                        ? name(playerMatch.ns === playerId ? playerMatch.ew : playerMatch.ns)
                        : '—'}
                      ：
                      <span className="butler-total">
                        {playerButlers.length ? signed(opponentButlerTotal) : '—'}
                      </span>
                    </div>
                    <small className="muted">加總本圈兩室已收的有效成績；取消牌不計入。</small>
                  </div>
                  <div
                    key={`${playerId}-${playerRound}-${playerVpBoards}`}
                    id="player-vp-scale"
                    popover="auto"
                    className="player-detail-popover vp-scale-popover"
                  >
                    <strong>
                      第 {roundLabel(event, playerRound)} 圈 · {playerVpBoards} 牌 VP 計分
                    </strong>
                    <p>{event.teamMethod === 'bam' ? `每牌勝／和／負 ${event.bam?.win ?? 2}／${event.bam?.draw ?? 1}／${event.bam?.loss ?? 0} VP，直接加總` : 'WBF 20–0 · 依原訂牌數換算'}</p>
                    {provisionalVp && <p className="muted">暫計 VP：依目前已比對成績估算，尚未計入累積 VP 與排名。</p>}
                    <p>
                      {playerMatchVp === null
                        ? '成績未齊，尚未換算 VP'
                        : event.teamMethod === 'bam' ? `我方本圈 ${number(playerMatchVp)} VP` : `我方 ${signed(playerImpTotal)} IMP → ${number(playerMatchVp)} VP`}
                    </p>
                    {playerVpScale.length ? (
                      <div className="vp-scale-scroll">
                        <table aria-label={`${playerVpBoards} 牌 VP 換算表`}>
                          <thead>
                            <tr>
                              <th>IMP 差</th>
                              <th>勝方 VP</th>
                              <th>負方 VP</th>
                            </tr>
                          </thead>
                          <tbody>
                            {playerVpScale.map((entry, index) => (
                              <tr
                                key={entry.margin}
                                className={
                                  playerMatchVp !== null &&
                                  Math.min(Math.abs(playerImpTotal), playerVpScale.length - 1) ===
                                    entry.margin
                                    ? 'vp-scale-current'
                                    : undefined
                                }
                              >
                                <td>
                                  {entry.margin}
                                  {index === playerVpScale.length - 1 ? '+' : ''}
                                </td>
                                <td>{number(entry.winner)}</td>
                                <td>{number(entry.loser)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p>{event.teamMethod === 'bam' ? '取消牌不給分；收齊後將本圈 VP 計入總排名。' : '本圈沒有可計分的牌。'}</p>
                    )}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        {Boolean(event.kind !== 'teams') && (
          <table>
            <thead>
              <tr>
                {event.kind !== 'teams' && (
                  <th aria-sort={playerSort === 'round' ? 'ascending' : 'none'}>
                    <button className="contract-link" onClick={() => setPlayerSort('round')}>
                      桌次
                    </button>
                  </th>
                )}
                <th aria-sort={playerSort === 'board' ? 'ascending' : 'none'}>
                  <button className="contract-link" onClick={() => setPlayerSort('board')}>
                    牌號
                  </button>
                </th>
                <th>{event.kind === 'teams' ? '房間' : '方向'}</th>
                {event.kind !== 'teams' && (
                  <th aria-sort={playerSort === 'opponent' ? 'ascending' : 'none'}>
                    <button className="contract-link" onClick={() => setPlayerSort('opponent')}>
                      對手
                    </button>
                  </th>
                )}
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
                  .map((result) => result);
                const datum = directionalDatum(scores)[ns ? 'ns' : 'ew'].datum;
                const popupId = `player-${a.id}-${b}`;
                const openBoard = () => {
                  setSelectedResult('');
                  setTravellerSide(ns ? 'ns' : 'ew');
                  setBoard(b);
                  setTab('boards');
                };
                return (
                  <tr key={resultKey(a.id, b)} className={shaded ? 'even-round' : undefined}
                    onMouseEnter={() => setHoveredRow({ playerId, board: b })}
                    onMouseLeave={() => setHoveredRow(null)}>
                    {event.kind !== 'teams' && (
                      <td>
                        <button
                          className="contract-link"
                          title="查看本圈對戰"
                          onClick={() => {
                            setRound(a.round);
                            setTab('rounds');
                          }}
                        >
                          <strong className="player-round">R{roundLabel(event, a.round)}</strong>
                          <small className="muted">/{a.table}</small>
                        </button>
                      </td>
                    )}
                    <td>
                      <button className="text-button" title="查看牌局" onClick={openBoard}>
                        {b}
                      </button>
                    </td>
                    <td>
                      {event.kind === 'teams'
                        ? a.room === 'open'
                          ? '公開'
                          : '關閉'
                        : ns
                          ? 'NS'
                          : 'EW'}
                    </td>
                    {event.kind !== 'teams' && (
                      <td>
                        <span className="opponent-name">
                          {name(ns ? a.ew : a.ns)}{' '}
                          <small className="muted">
                            {participantNumber(ns ? a.ew : a.ns, event.kind)}
                          </small>
                        </span>
                        <button
                          className="opponent-number contract-link"
                          title="查看對手姓名" popoverTarget={`${popupId}-opponent`}
                          onClick={(e) => positionDetail(e.currentTarget)}
                        >
                          {participantNumber(ns ? a.ew : a.ns, event.kind)}
                        </button>
                        <div
                          id={`${popupId}-opponent`}
                          popover="auto"
                          className="player-detail-popover"
                        >
                          對手：{participantNumber(ns ? a.ew : a.ns, event.kind)} ·{' '}
                          {name(ns ? a.ew : a.ns)}
                        </div>
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        className="contract-link"
                        aria-label={`查看牌號 ${b} 的逐副成績`}
                        title="查看牌局" onClick={openBoard}
                      >
                        <Contract result={r} />
                      </button>
                    </td>
                    <td className="mono">
                      <button
                        className="player-raw-score contract-link"
                        title="查看本牌 Datum" popoverTarget={`${popupId}-average`}
                        onClick={(e) => positionDetail(e.currentTarget)}
                      >
                        {r && r.status !== 'cancelled'
                          ? signed(awardedResult(r, ns ? 'ns' : 'ew')!.nsScore * (ns ? 1 : -1))
                          : '—'}
                      </button>
                      <div
                        id={`${popupId}-average`}
                        popover="auto"
                        className="player-detail-popover"
                      >
                        牌號 {b} · {ns ? 'NS' : 'EW'} Datum{' '}
                        {datum === null ? '—' : signed(datum)}（
                        {scores.length} 桌有效結果）
                      </div>
                    </td>
                    {event.kind === 'pairs' && (
                      <td
                        className={
                          event.kind === 'pairs'
                            ? `player-points ${pairTone(value, mp?.top ?? 0, pairMethod)}`
                            : undefined
                        }
                      >
                        <span className="player-points-value">
                          <PairScoreValue value={value} top={mp?.top ?? 0} method={pairMethod} />
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
      {event.kind === 'pairs' && event.showScoreCandles !== false && <PairScoreChart key={`${event.id}:${playerId}`} event={event} person={playerId} hoveredBoard={hoveredRow?.playerId === playerId ? hoveredRow.board : null} />}
    </div>
    </div>
  );
}
