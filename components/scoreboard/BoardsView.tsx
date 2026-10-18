import { displayedBoardNumber, boardRounds as getBoardRounds } from '@/lib/board-navigation';
import { directionalDatum } from '@/lib/datum';
import { exportPbn } from '@/lib/imports';
import type { Assignment, Board, PublicEvent, Result } from '@/lib/model';
import { resultKey } from '@/lib/model';
import { awardedResult, imps, teamBoardPoints } from '@/lib/scoring';
import { tableNames } from '@/lib/table-names';
import { isInterleaved, roundLabel } from '@/lib/team-movement';
import { ArrowDownToLine, ArrowLeft, ArrowRight } from 'lucide-react';
import { BoardInformation, DealExplorer } from '../deal-explorer';
import { HcpSummary } from '../hcp-fields';
import { ReviewExport } from '../review-export';
import { Contract, download, hasDeal, pairTone, pairValue, signed } from '../scoreboard-shared';
import { DealDiagram } from '../scoreboard-widgets';

type Props = {
  awayPerspective: boolean;
  board: number;
  director: boolean;
  event: PublicEvent;
  previewDeal: () => Promise<void>;
  previewing: boolean;
  privateDeal: {
    eventId: string;
    board: Board;
    results: PublicEvent['results'];
    pairScores: PublicEvent['projection']['pairScores'];
  } | null;
  resultSelection: number;
  resultSort: string;
  selectedResult: string;
  setAwayPerspective: React.Dispatch<React.SetStateAction<boolean>>;
  setBoard: React.Dispatch<React.SetStateAction<number>>;
  setPrivateDeal: React.Dispatch<
    React.SetStateAction<{
      eventId: string;
      board: Board;
      results: PublicEvent['results'];
      pairScores: PublicEvent['projection']['pairScores'];
    } | null>
  >;
  setResultSelection: React.Dispatch<React.SetStateAction<number>>;
  setResultSort: React.Dispatch<React.SetStateAction<string>>;
  setSelectedResult: React.Dispatch<React.SetStateAction<string>>;
  setTravellerSide: React.Dispatch<React.SetStateAction<'ns' | 'ew'>>;
  travellerSide: 'ns' | 'ew';
};
export function BoardsView({
  awayPerspective,
  board,
  director,
  event,
  previewDeal,
  previewing,
  privateDeal,
  resultSelection,
  resultSort,
  selectedResult,
  setAwayPerspective,
  setBoard,
  setPrivateDeal,
  setResultSelection,
  setResultSort,
  setSelectedResult,
  setTravellerSide,
  travellerSide,
}: Props) {
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
  const name = (pid: string) => event?.participants.find((p) => p.id === pid)?.name ?? pid;
  const selectedBoard = event?.boards.find((b) => b.number === board) ?? event?.boards[0];
  const displayBoard =
    director &&
    privateDeal &&
    privateDeal.eventId === event?.id &&
    privateDeal.board.number === selectedBoard?.number
      ? privateDeal.board
      : selectedBoard;
  const privatePreview = displayBoard !== selectedBoard ? privateDeal : null;
  const boardResults = privatePreview?.results ?? event?.results ?? {};
  const boardPairScores = privatePreview?.pairScores ?? event?.projection.pairScores ?? {};
  const boardRounds = event ? getBoardRounds(event) : [];
  const boardRound =
    boardRounds.find((r) => r.boards.includes(selectedBoard?.number ?? 0)) ?? boardRounds[0];
  const completedBoardScores =
    event && selectedBoard
      ? event.assignments
          .filter(
            (a) =>
              a.boards.includes(selectedBoard.number) &&
              (event.kind !== 'teams' ||
                isInterleaved(event.assignments) ||
                a.round ===
                  (event.assignments.find((x) => x.id === selectedResult)?.round ??
                    boardRound?.round)),
          )
          .map((a) => boardResults[resultKey(a.id, selectedBoard.number)])
          .filter((r) => r && r.status !== 'cancelled' && r.status !== 'average')
          .map((r) => r)
      : [];
  const boardDatums = directionalDatum(
    completedBoardScores,
    event?.kind === 'pairs' && event.pairMethod === 'butler' ? event.trim : 'none',
  );
  const pairMethod = event?.pairMethod ?? 'mp';
  const displayBoardNumber = (n: number) => displayedBoardNumber(n, event ?? undefined);
  const butlerHint = (r: Result | undefined, side: 'ns' | 'ew') =>
    r && r.status !== 'cancelled' && r.status !== 'average' && boardDatums[side].datum !== null ? (
      <span className="muted butler-imp" title={`Butler IMP（${side.toUpperCase()} 視角）`}>
        (
        {signed(
          imps(
            awardedResult(r, side)!.nsScore * (side === 'ns' ? 1 : -1) - boardDatums[side].datum!,
          ),
        )}
        )
      </span>
    ) : null;
  const scoreSide = event?.kind === 'pairs' ? travellerSide : 'ns';
  const sideSign = scoreSide === 'ns' ? 1 : -1;
  const sideLabel = scoreSide.toUpperCase();
  const traveller =
    event && selectedBoard
      ? event.assignments
          .filter(
            (a) =>
              a.boards.includes(selectedBoard.number) &&
              (event.kind !== 'teams' ||
                isInterleaved(event.assignments) ||
                a.round ===
                  (event.assignments.find((x) => x.id === selectedResult)?.round ??
                    boardRound?.round)),
          )
          .sort((a, b) => {
            if (event.kind === 'teams')
              return String(a.table).localeCompare(String(b.table), 'en', { numeric: true });
            if (resultSort.startsWith('table'))
              return (
                (String(a.table).localeCompare(String(b.table), 'en', { numeric: true }) ||
                  a.round - b.round) * (resultSort.endsWith('desc') ? -1 : 1)
              );
            const value = (assignment: Assignment) => {
              const key = resultKey(assignment.id, selectedBoard.number),
                r = boardResults[key];
              if (!r || r.status === 'cancelled') return null;
              if (resultSort.startsWith('points')) {
                const points = boardPairScores[key];
                const score = points?.[scoreSide];
                return score == null
                  ? null
                  : pairMethod === 'mp'
                    ? points.top > 0
                      ? score / points.top
                      : null
                    : score;
              }
              return awardedResult(r, scoreSide)!.nsScore * sideSign;
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
  const activeResult = boardResults[resultKey(selectedResult, selectedBoard?.number ?? 0)];
  const activeAssignment = event?.assignments.find(
    (a) => a.id === selectedResult && a.boards.includes(selectedBoard?.number ?? 0),
  );
  const activeNames = event ? tableNames(event.kind, event.participants, activeAssignment) : {};
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
          <strong className="board-number" aria-hidden="true">
            {displayBoardNumber(selectedBoard.number)}
          </strong>
          <select
            aria-label="選擇牌號"
            value={selectedBoard.number}
            onChange={(e) => browseBoard(Number(e.target.value))}
          >
            {event.kind === 'teams'
              ? boardRounds.map((round) => (
                  <optgroup
                    key={round.round}
                    label={'第 ' + roundLabel(event, round.round) + ' 圈'}
                  >
                    {round.boards.map((number, index) => (
                      <option key={index} value={number}>
                        牌號 {displayBoardNumber(number)}（圈內第 {index + 1} 牌）
                      </option>
                    ))}
                  </optgroup>
                ))
              : event.boards.map((board) => (
                  <option key={board.number} value={board.number}>
                    牌號 {displayBoardNumber(board.number)}
                  </option>
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
  if (!selectedBoard) return null;
  return (
    <>
      <div className="board-layout">
        {activeResult?.split && (
          <section className="panel">
            <div className="panel-heading">
              <h3>不平衡合約</h3>
              <p className="footnote">下方牌局保留原始紀錄；判罰後各方分別依下列合約計分。</p>
              {(['ns', 'ew'] as const).map((side) => (
                <p key={side}>
                  {side.toUpperCase()} 獲判：
                  <Contract result={awardedResult(activeResult, side)} /> ·{' '}
                  <span className="mono">
                    {signed(awardedResult(activeResult, side)!.nsScore * (side === 'ns' ? 1 : -1))}
                  </span>
                </p>
              ))}
            </div>
          </section>
        )}
        <section className="panel deal-panel">
          {activeResult?.hcp && (
            <div className="panel-heading">
              <HcpSummary hcp={activeResult.hcp} />
            </div>
          )}
          {displayBoard !== selectedBoard && (
            <div className="panel-heading">
              <p>裁判私下檢視 · 牌型與未發布成績僅在此裝置顯示</p>
              <button type="button" className="button subtle" onClick={() => setPrivateDeal(null)}>
                關閉私下檢視
              </button>
              <button
                type="button"
                className="button subtle"
                disabled={previewing}
                onClick={previewDeal}
              >
                更新私下成績
              </button>
            </div>
          )}
          {displayBoard && hasDeal(displayBoard) && displayBoard.deal.N.length === 13 ? (
            <DealExplorer
              key={`${event.id}:${selectedBoard.number}`}
              board={displayBoard}
              miniBridge={event.gameMode === 'minibridge'}
              result={activeResult}
              playerNames={activeNames}
              resultSelection={resultSelection}
              tableSelected={!!activeAssignment}
              onManualTrial={() => setSelectedResult('')}
              navigation={boardNavigation}
              averageScore={boardDatums[scoreSide].datum}
              scoreSide={sideLabel}
              datumDetails={{
                ns: boardDatums.ns.mean,
                ew: boardDatums.ew.mean,
                split: boardDatums.split,
              }}
              validResults={completedBoardScores.length}
            />
          ) : (
            <div className="unpublished-board">
              <BoardInformation
                number={selectedBoard.number}
                averageScore={boardDatums[scoreSide].datum}
                scoreSide={sideLabel}
                datumDetails={{
                  ns: boardDatums.ns.mean,
                  ew: boardDatums.ew.mean,
                  split: boardDatums.split,
                }}
                validResults={completedBoardScores.length}
                navigation={boardNavigation}
              />
              <DealDiagram
                board={selectedBoard}
                onPreview={director && !hasDeal(selectedBoard) ? previewDeal : undefined}
                previewing={previewing}
              />
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
              <ReviewExport
                board={selectedBoard}
                event={event}
                selectedAssignmentId={selectedResult}
              />
            </div>
          )}
        </section>
        <section className="panel board-results">
          <div className="panel-heading">
            <div>
              <h3>
                {event.kind === 'teams'
                  ? event.teamMovement
                    ? '跨圈兩桌逐副比較'
                    : '開閉兩室逐副比較'
                  : '單副成績表'}
              </h3>
            </div>
            {event.kind === 'teams' && (
              <button
                type="button"
                className="button subtle"
                aria-pressed={awayPerspective}
                onClick={() => setAwayPerspective((value) => !value)}
              >
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
                    <th>我方合約 (NS)</th>
                    <th>對方合約 (EW)</th>
                    <th>{event.teamMethod === 'bam' ? 'VP' : 'IMP'}</th>
                  </tr>
                </thead>
                <tbody>
                  {traveller
                    .filter((a) => a.room === 'open' && a.boards.includes(selectedBoard.number))
                    .map((a) => {
                      const closed = event.assignments.find(
                        (c) => c.matchId === a.matchId && c.room === 'closed',
                      )!;
                      const x = boardResults[resultKey(a.id, selectedBoard.number)],
                        y = boardResults[resultKey(closed.id, selectedBoard.number)];
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
                            <strong
                              className="board-team-name"
                              title={name(awayPerspective ? a.ew : a.ns)}
                            >
                              {name(awayPerspective ? a.ew : a.ns)}
                            </strong>
                            <small
                              className="block muted board-team-name"
                              title={name(awayPerspective ? a.ns : a.ew)}
                            >
                              vs {name(awayPerspective ? a.ns : a.ew)}
                            </small>
                          </td>
                          <td>
                            <Contract result={own} />
                            <small className="block mono team-raw-score">
                              {own?.status === 'average'
                                ? '取消'
                                : own && own.status !== 'cancelled'
                                  ? signed(own.nsScore)
                                  : '—'}
                              {butlerHint(own, 'ns')}
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
                              {opponent?.status === 'average'
                                ? '取消'
                                : opponent && opponent.status !== 'cancelled'
                                  ? signed(opponent.nsScore)
                                  : '—'}
                              {butlerHint(opponent, 'ew')}
                            </small>
                          </td>
                          <td className="accent mono">
                            {x?.status === 'cancelled' || y?.status === 'cancelled'
                              ? '取消'
                              : x && y
                                ? signed(
                                    x.status === 'average' || y.status === 'average'
                                      ? 0
                                      : teamBoardPoints(x, y, event)[awayPerspective ? 1 : 0],
                                  )
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
                        onClick={() => setTravellerSide(travellerSide === 'ns' ? 'ew' : 'ns')}
                      >
                        <span className={travellerSide === 'ns' ? 'side-active' : 'side-muted'}>
                          NS
                        </span>{' '}
                        /{' '}
                        <span className={travellerSide === 'ew' ? 'side-active' : 'side-muted'}>
                          EW
                        </span>
                      </button>
                    </th>
                    <th>合約</th>
                    {sortHeading('score', `${sideLabel} 分`)}
                    {sortHeading('points', `${sideLabel} ${pairMethod === 'mp' ? 'MP%' : 'IMP'}`)}
                  </tr>
                </thead>
                <tbody>
                  {traveller
                    .filter(
                      (a) =>
                        a.boards.includes(selectedBoard.number) &&
                        (event.kind !== 'teams' ||
                          isInterleaved(event.assignments) ||
                          a.round ===
                            (event.assignments.find((x) => x.id === selectedResult)?.round ??
                              boardRound?.round)),
                    )
                    .map((a) => {
                      const key = resultKey(a.id, selectedBoard.number),
                        r = boardResults[key],
                        mp = boardPairScores[key];
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
                            {a.table}{' '}
                            <small className="muted">/ R{roundLabel(event, a.round)}</small>
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
                              ? signed(awardedResult(r, scoreSide)!.nsScore * sideSign)
                              : '—'}
                          </td>
                          <td
                            className={`mono ${pairTone(mp?.[travellerSide], mp?.top ?? 0, pairMethod)}`}
                          >
                            {pairValue(mp?.[travellerSide], mp?.top ?? 0, pairMethod)}
                            {mp?.provisional && <small className="block muted">暫定</small>}
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
              {event.teamMethod === 'bam' ? 'BAM：以目前視角比較兩室原始分，依每牌勝／和／負給予 VP。' : awayPerspective
                ? '目前為客隊視角：IMP 以左列第一支隊伍為正，閉室 NS 分減去開室 NS 分後換算。'
                : '目前為主隊視角：IMP 以左列第一支隊伍為正，開室 NS 分減去閉室 NS 分後換算。'}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
