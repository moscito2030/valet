import { boardRange } from '@/lib/board-groups';
import { roundLabel } from '@/lib/team-movement';
import type { PublicEvent } from '@/lib/model';
import { resultKey } from '@/lib/model';
import { awardedResult, teamBoardImps } from '@/lib/scoring';
import { Contract, signed } from './scoreboard-shared';

export function InterleavedRound({
  event,
  round,
  teamId,
  onBoard,
}: {
  event: PublicEvent;
  round: number;
  teamId?: string;
  onBoard: (board: number, assignmentId: string) => void;
}) {
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;
  const tables = event.assignments.filter(
    (a) => a.round === round && (!teamId || a.ns === teamId || a.ew === teamId),
  );
  const matches = event.projection.matches.filter((m) => tables.some((a) => a.matchId === m.id));
  const number = (n: number | null) => (n === null ? '—' : n.toFixed(2));
  return (
    <div className="interleaved-round">
      <p className="footnote">
        交錯循環：南北／東西為各隊固定搭檔，請依桌號與牌號移動。兩桌分別在不同圈打牌，收齊後比較；VP
        歸入第 {roundLabel(event, Math.ceil(round / 2) * 2)} 圈。
      </p>
      <div className="table-scroll">
        <table aria-label="交錯循環實際入座">
          <thead>
            <tr>
              <th>桌號</th>
              <th>南北</th>
              <th>東西</th>
              <th>牌號</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((a) => (
              <tr key={a.id}>
                <td>{a.table}</td>
                <td>{name(a.ns)}</td>
                <td>{name(a.ew)}</td>
                <td>{boardRange(a.boards)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {teamId &&
        matches.map((m) => {
          const open = event.assignments.find((a) => a.matchId === m.id && a.room === 'open')!;
          const closed = event.assignments.find((a) => a.matchId === m.id && a.room === 'closed')!;
          const own = teamId === m.a ? open : closed,
            other = teamId === m.a ? closed : open;
          return (
            <section key={m.id}>
              <h4>
                {name(teamId)} vs {name(teamId === m.a ? m.b : m.a)}
              </h4>
              <p>
                VP {number(teamId === m.a ? m.vpA : m.vpB)} :{' '}
                {number(teamId === m.a ? m.vpB : m.vpA)} · 已比對 {m.completed} / {m.total} 副
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>牌號</th>
                      <th>
                        我方南北：第 {roundLabel(event, own.round)} 圈／{own.table} 桌
                      </th>
                      <th>
                        我方東西：第 {roundLabel(event, other.round)} 圈／{other.table} 桌
                      </th>
                      <th>IMP 差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.boards.map((board) => {
                      const x = event.results[resultKey(open.id, board)],
                        y = event.results[resultKey(closed.id, board)];
                      const cancelled = [x, y].some(
                        (r) => r?.status === 'cancelled' || r?.status === 'average',
                      );
                      const imp =
                        x && y && !cancelled ? teamBoardImps(x, y)[teamId === m.a ? 0 : 1] : null;
                      return (
                        <tr key={board}>
                          <td>{board}</td>
                          {[own, other].map((a, index) => {
                            const r = awardedResult(
                              event.results[resultKey(a.id, board)],
                              index === 0 ? 'ns' : 'ew',
                            );
                            return (
                              <td key={a.id}>
                                <button
                                  className="contract-link"
                                  aria-label={`查看第 ${roundLabel(event, a.round)} 圈 ${a.table} 桌牌號 ${board}`}
                                  onClick={() => onBoard(board, a.id)}
                                >
                                  <Contract result={r} />
                                  <small className="block mono">
                                    {!r || r.status === 'cancelled' || r.status === 'average'
                                      ? '—'
                                      : signed(r.nsScore * (index === 0 ? 1 : -1))}
                                  </small>
                                </button>
                              </td>
                            );
                          })}
                          <td>{imp === null ? '—' : imp}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
    </div>
  );
}
