import { KnockoutView } from '../knockout-view';
import { WinAwards } from './WinAwards';
import { awardPlacesFor } from '@/lib/awards';
import type { PublicEvent } from '@/lib/model';
import { participantNumber } from '@/lib/participant-number';
import { allRoundsComplete } from '@/lib/round-progress';
import { Search, Star, Trophy } from 'lucide-react';
import { number, Tab } from '../scoreboard-shared';

type Props = {
  event: PublicEvent;
  follow: string;
  id: string;
  query: string;
  setPerson: React.Dispatch<React.SetStateAction<string>>;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  setTab: React.Dispatch<React.SetStateAction<Tab>>;
  toggleFollow: (value: string) => void;
};
export function StandingsView({
  event,
  follow,
  id,
  query,
  setPerson,
  setQuery,
  setTab,
  toggleFollow,
}: Props) {
  if (event.knockout)
    return (
      <>
        <KnockoutView event={event} />
        <WinAwards event={event} participantIds={event.participants.map((p) => p.id)} />
      </>
    );
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
  const competitionComplete = event?.status === 'finished' || (!!event && allRoundsComplete(event));
  const pairMethod = event?.pairMethod ?? 'mp';
  const visibleStandings = event
    ? event.projection.standings.filter((s) => {
        const participant =
          event.kind === 'teams' ? event.participants.find((p) => p.id === s.id) : undefined;
        return [
          s.name,
          participantNumber(s.id, event.kind),
          participant?.players,
          participant?.captain,
        ].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase()));
      })
    : [];

  const doubleWinner =
    event.kind === 'pairs' &&
    event.participants.length > 0 &&
    event.participants.every((p) => p.group);
  function rankLabel(row: (typeof event.projection.standings)[number]) {
    const tied = event.projection.standings.filter(
      (s) => s.rank === row.rank && (!doubleWinner || s.group === row.group),
    ).length;
    return tied > 1 ? `${row.rank}-${row.rank + tied - 1}` : String(row.rank);
  }
  const tables = doubleWinner
    ? (['NS', 'EW'] as const).map((group) => ({
        group,
        rows: visibleStandings.filter((s) => s.group === group),
      }))
    : [{ group: undefined, rows: visibleStandings }];

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h3>
            總排名 <span className="badge">{competitionComplete ? '最終成績' : '暫定成績'}</span>
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
      {tables.map(({ group, rows }) => (
        <div className="table-scroll" key={group ?? 'all'}>
          <table className={`ranking-table${event.kind === 'teams' ? ' team-ranking-table' : ''}`}>
            {group && (
              <caption className="ranking-group-title">
                {group === 'NS' ? '南北 NS 排名' : '東西 EW 排名'}
              </caption>
            )}
            <thead>
              <tr>
                <th className="rank-col">排名</th>

                <th>{event.kind === 'teams' ? '隊伍' : '搭檔'}</th>
                <th>完成／安排牌數</th>
                <th className="score-col">
                  {event.kind === 'teams' ? '累計 VP' : pairMethod === 'mp' ? '總百分比' : '總 IMP'}
                </th>
                <th aria-label="追蹤" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={follow === `${id}:${s.id}` ? 'followed' : ''}>
                  <td>
                    <span className={`rank rank-${s.rank}`}>
                      {s.rank <= awardPlacesFor(event, s.group) ? (
                        <>
                          <Trophy size={13} />
                          {rankLabel(s)}
                        </>
                      ) : (
                        rankLabel(s)
                      )}
                    </span>
                  </td>

                  <td>
                    <button
                      className="participant-link"
                      onClick={() => {
                        setPerson(s.id);
                        setTab('players');
                      }}
                    >
                      <span>
                        <span className="standing-name" title={s.name}>
                          {s.name}
                        </span>
                        <small>
                          {participantNumber(s.id, event.kind)}
                          {event.kind !== 'teams' && s.players && ` · ${s.players}`}
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
                      <small>{event.kind === 'pairs' && pairMethod === 'mp' ? '%' : ''}</small>
                    </button>
                    <div id={`standing-${s.id}`} popover="auto" className="player-detail-popover">
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
                      {event.projection.byes
                        ?.filter((b) => b.participantId === s.id)
                        .map((b) => (
                          <div key={b.round}>
                            第 {b.round} 圈輪空：{number(b.vp)} VP（
                            {b.awarded ? '已計入' : '待收齊'}）
                          </div>
                        ))}
                      <div>
                        調整 {event.kind === 'teams' ? 'VP' : pairMethod === 'mp' ? 'MP' : 'IMP'}：
                        {number(
                          s.penalty ?? 0,
                          pairMethod === 'butler' && Number.isInteger(s.penalty ?? 0) ? 0 : 2,
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
          {rows.length === 0 && <div className="empty compact">沒有符合的參賽者</div>}
        </div>
      ))}
      <WinAwards event={event} participantIds={visibleStandings.map((s) => s.id)} />
      <div className="table-footer">
        <span>
          <i className="live-dot" />
          {event.status === 'finished' ? '賽事已結束' : '成績每 30 秒更新'} · v{event.revision}
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
  );
}
