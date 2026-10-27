'use client';
import type { PublicEvent } from '@/lib/model';
import type { KnockoutSource } from '@/lib/knockout-schema';
import { knockoutDecisionLabel, exportKnockoutCsv, knockoutPrintHtml } from '@/lib/knockout-report';
import { knockoutScore, knockoutSource } from '@/lib/knockout';
export function KnockoutView({ event }: { event: PublicEvent }) {
  const ko = event.knockout;
  if (!ko) return null;
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;
  const sourceLabel = (s: KnockoutSource) => {
    const id = knockoutSource(s, ko);
    return id
      ? name(id)
      : s.kind === 'bye'
        ? '輪空'
        : s.kind === 'team'
          ? name(s.id)
          : `${ko.nodes.find((n) => n.id === s.id)?.name ?? s.id} ${s.kind === 'winner' ? '勝方' : '敗方'}`;
  };
  const placements = ko.nodes
    .flatMap((n) => {
      const d = ko.decisions[n.id];
      return d
        ? [
            ...(n.winnerPlace && d.winner ? [{ place: n.winnerPlace, id: d.winner }] : []),
            ...(n.loserPlace && d.loser ? [{ place: n.loserPlace, id: d.loser }] : []),
          ]
        : [];
    })
    .sort((a, b) => a.place - b.place);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>淘汰賽對戰表</h2>
          <p>{event.teamMethod === 'bam' ? 'BAM 累計決勝' : '純 IMP 累計淨差決勝'}；勝負與最終名次由裁判確認後公布。</p>
        </div>
      </div>
      <div className="button-row">
        <button className="button subtle" onClick={() => { const url = URL.createObjectURL(new Blob([exportKnockoutCsv(event)], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `${event.id}-knockout.csv`; a.click(); URL.revokeObjectURL(url); }}>匯出淘汰賽成績 CSV</button>
        <button className="button subtle" onClick={() => { const page = window.open('', '_blank'); if (!page) return; page.opener = null; page.document.write(knockoutPrintHtml(event)); page.document.close(); page.focus(); page.print(); }}>列印淘汰賽成績</button>
      </div>
      {!!placements.length && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>名次</th>
                <th>隊伍</th>
              </tr>
            </thead>
            <tbody>
              {placements.map((p) => (
                <tr key={p.place}>
                  <td>{p.place}</td>
                  <td>{name(p.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="knockout-grid">
        {[...new Set(ko.nodes.map((n) => n.startRound))]
          .sort((a, b) => a - b)
          .map((round) => (
            <section key={round} className="knockout-stage">
              <h3>第 {round} 圈起</h3>
              {ko.nodes
                .filter((n) => n.startRound === round)
                .map((n) => {
                  const p = ko.published[n.id],
                    d = ko.decisions[n.id],
                    s = knockoutScore(event, n, event.projection);
                  return (
                    <article className="knockout-card" key={n.id}>
                      <h4>{n.name}</h4>
                      <p>
                        {sourceLabel(n.a)}
                        <br />對 {sourceLabel(n.b)}
                      </p>
                      <small>
                        第 {n.startRound}–{n.startRound + n.rounds - 1} 圈 · 每圈 {n.boardsPerRound}{' '}
                        牌 · 第 {n.table} 桌
                      </small>
                      <p>
                        {!p
                          ? '待公布'
                          : p.b === null
                            ? d?.method === 'withdrawal' ? (p.a ? '對手退賽，免賽晉級' : '雙方退賽，無勝方') : '輪空晉級'
                            : `${s.a.toFixed(2)} : ${s.b.toFixed(2)} ${event.teamMethod === 'bam' ? 'VP' : 'IMP'}${s.complete ? '' : '（未收齊）'}`}
                      </p>
                      {d?.winner && <strong>勝方：{name(d.winner)}</strong>}
                      {d && <p>{knockoutDecisionLabel(d.method)}：{d.reason}</p>}
                      {ko.adjustments?.[n.id] && <p>IMP 調整 {ko.adjustments[n.id].a} / {ko.adjustments[n.id].b}：{ko.adjustments[n.id].reason}</p>}
                      {ko.extraLegs?.[n.id]?.map((leg) => <p key={leg.round}>加賽：第 {leg.round} 圈，{leg.boards.length} 牌</p>)}
                      {n.winnerPlace && (
                        <p className="footnote">
                          勝方第 {n.winnerPlace} 名
                          {n.loserPlace ? `／敗方第 ${n.loserPlace} 名` : ''}
                        </p>
                      )}
                    </article>
                  );
                })}
            </section>
          ))}
      </div>
      <p className="footnote">未顯示名次的隊伍，尚未經指定順位對局確認最終名次。</p>
    </section>
  );
}
