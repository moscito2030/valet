import { boardRange } from '@/lib/board-groups';
import type { PublicEvent } from '@/lib/model';
import { resultKey } from '@/lib/model';
import { participantNumber } from '@/lib/participant-number';
import { pairStandingsBeforeRound, teamStandingsThroughRound } from '@/lib/scoring';
import { roundLabel } from '@/lib/team-movement';
import { ArrowRight } from 'lucide-react';
import { MatchVpScale } from '../match-vp-scale';
import { InterleavedRound } from '../interleaved-round';
import { number, signed, Tab } from '../scoreboard-shared';
import { RoundSelect } from '../scoreboard-widgets';

type Props = {
  event: PublicEvent;
  round: number;
  setBoard: React.Dispatch<React.SetStateAction<number>>;
  setPerson: React.Dispatch<React.SetStateAction<string>>;
  setPlayerRound: React.Dispatch<React.SetStateAction<number>>;
  setRound: React.Dispatch<React.SetStateAction<number>>;
  setSelectedResult: React.Dispatch<React.SetStateAction<string>>;
  setTab: React.Dispatch<React.SetStateAction<Tab>>;
};
export function RoundsView({
  event,
  round,
  setBoard,
  setPerson,
  setPlayerRound,
  setRound,
  setSelectedResult,
  setTab,
}: Props) {
  const name = (pid: string) => event?.participants.find((p) => p.id === pid)?.name ?? pid;
  const pairMethod = event?.pairMethod ?? 'mp';
  const selectedRoundMatches =
    event?.projection.matches.filter((m) =>
      event.teamMovement === 'interleaved'
        ? event.assignments.some((a) => a.round === round && a.matchId === m.id)
        : m.round === round,
    ) ?? [];
  const roundPairStandings = event?.kind === 'pairs' ? pairStandingsBeforeRound(event, round) : [];
  const roundTeamStandings = event?.kind === 'teams' ? teamStandingsThroughRound(event, round) : [];

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>圈次與對戰</h3>
          <p>
            {event.kind === 'teams'
              ? event.teamMethod === 'bam'
                ? '查看各圈 BAM VP 與收分進度。'
                : '查看各圈 IMP 比較與收分進度。'
              : '查看桌次、南北／東西搭檔與牌組安排。'}
          </p>
        </div>
        <RoundSelect event={event} count={event.rounds} round={round} setRound={setRound} />
      </div>
      {event.teamMovement === 'interleaved' && (
        <InterleavedRound
          event={event}
          round={round}
          onBoard={(b, a) => {
            setBoard(b);
            setSelectedResult(a);
            setTab('boards');
          }}
        />
      )}
      {event.swiss && (
        <p className="footnote team-bye-note">
          Swiss：尚未出現在本圈對戰或輪空名單的隊伍，請等待裁判公布安排；未安排不代表輪空。
        </p>
      )}
      {event.projection.byes
        ?.filter((b) => b.round === round)
        .map((b) => (
          <p key={b.participantId} className="footnote team-bye-note">
            {name(b.participantId)}：輪空，{number(b.vp)} VP（
            {b.awarded ? '已計入排名' : '本圈收分完成後計入'}）。不計 IMP 或實打牌數。
          </p>
        ))}
      {event.kind === 'teams' ? (
        <div className="match-grid">
          {selectedRoundMatches.map((m) => (
            <div className="match-card" key={m.id}>
              <div className="match-meta">
                {event.teamMovement === 'interleaved'
                  ? `與 ${roundLabel(event, event.assignments.find((a) => a.matchId === m.id && a.round !== round)!.round)} 圈比較`
                  : `第 ${event.assignments.find((a) => a.matchId === m.id)?.table ?? '—'} 桌`}{' '}
                <span>
                  {m.completed === m.total ? '已收齊' : `已比對 ${m.completed} / ${m.total} 副`}
                </span>
              </div>
              {[m.a, m.b].map((id, index) => {
                const standing = roundTeamStandings.find((s) => s.id === id);
                return (
                  <div className={`match-team ${index === 0 ? 'team-home' : 'team-away'}`} key={id}>
                    <button
                      className="match-team-link"
                      onClick={() => {
                        setPerson(id);
                        setPlayerRound(round);
                        setTab('players');
                      }}
                    >
                      <strong>{name(id)}</strong>
                      <small>
                        {participantNumber(id, event.kind)} / {number(standing?.score ?? null)} VP
                        {standing && !event.knockout && ` / #${standing.rank}`}
                      </small>
                    </button>
                    <b>
                      {event.teamMethod === 'bam'
                        ? `${number(index === 0 ? (m.bamA ?? 0) : (m.bamB ?? 0))} VP`
                        : m.split
                          ? `${signed(index === 0 ? m.marginA : m.marginB)} IMP 淨差`
                          : index === 0
                            ? m.impsA
                            : m.impsB}
                    </b>
                  </div>
                );
              })}
              <div className="match-bottom">
                <MatchVpScale event={event} match={m} />
                <button
                  className="match-results-link"
                  onClick={() => {
                    setPerson(m.a);
                    setPlayerRound(round);
                    setTab('players');
                  }}
                >
                  本場成績 <ArrowRight size={14} />
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
                    <td className="round-table-number">第 {a.table} 桌</td>
                    {[a.ns, a.ew].map((id) => {
                      const standing = roundPairStandings.find((s) => s.id === id);
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
                        className="text-button round-board-numbers"
                        title="查看牌局"
                        onClick={() => {
                          setBoard(a.boards[0]);
                          setTab('boards');
                        }}
                      >
                        {boardRange(a.boards)}
                      </button>
                    </td>
                    <td>
                      {a.boards.filter((b) => event.results[resultKey(a.id, b)]).length} /{' '}
                      {a.boards.length}
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
                        (a) => a.round === round && (a.ns === p.id || a.ew === p.id),
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
  );
}
