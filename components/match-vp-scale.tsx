'use client';
import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import type { MatchScore, PublicEvent } from '@/lib/model';
import { resultKey } from '@/lib/model';
import { vp } from '@/lib/scoring';
import { number, signed } from './scoreboard-shared';

export function MatchVpScale({ event, match }: { event: PublicEvent; match: MatchScore }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  if (event.knockout && event.teamMethod !== 'bam') return <span>純 IMP</span>;
  const bam = event.teamMethod === 'bam';
  const assignments = event.assignments.filter((a) => a.matchId === match.id);
  const open = assignments.find((a) => a.room === 'open');
  const closed = assignments.find((a) => a.room === 'closed');
  const hasComparedScore = !!open && !!closed && open.boards.some((board) => {
    const results = [event.results[resultKey(open.id, board)], event.results[resultKey(closed.id, board)]];
    return results.every((r) => r && r.status !== 'cancelled' && r.status !== 'average');
  });
  const provisional = (match.vpA === null || match.vpB === null) &&
    match.completed < match.total && match.total > 0 && hasComparedScore;
  const vpA = provisional ? (bam ? match.bamA ?? 0 : vp(match.marginA, match.total)) : match.vpA;
  const vpB = provisional ? (bam ? match.bamB ?? 0 : vp(match.marginB, match.total)) : match.vpB;
  const scale =
    !bam && match.total > 0
      ? Array.from({ length: Math.ceil(15 * Math.sqrt(match.total)) + 1 }, (_, margin) => ({
          margin,
          winner: vp(margin, match.total),
          loser: vp(-margin, match.total),
        }))
      : [];
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;
  const margins = match.split ? [match.marginA, match.marginB] : [match.impsA - match.impsB];
  return (
    <>
      <button
        type="button"
        className="match-vp-trigger"
        aria-label={`查看 ${name(match.a)} 對 ${name(match.b)} 的 ${match.total} 牌 VP 計分表`}
        onClick={() => {
          const modal = dialog.current;
          if (!modal) return;
          modal.showModal();
          const scroller = modal.querySelector<HTMLElement>('.vp-scale-scroll');
          const current = modal.querySelector<HTMLElement>('.vp-scale-current');
          if (scroller) {
            // Scroll only the table, keeping the dialog heading and page in place.
            scroller.scrollTop = current
              ? scroller.scrollTop + current.getBoundingClientRect().top -
                scroller.getBoundingClientRect().top -
                (scroller.clientHeight - current.offsetHeight) / 2
              : 0;
          }
        }}
      >
        <span className="muted">{provisional ? '暫計 VP' : 'VP'}</span>{' '}
        <b>
          <span className="team-home">{number(vpA)}</span> :{' '}
          <span className="team-away">{number(vpB)}</span>
        </b>
      </button>
      <dialog
        ref={dialog}
        className="modal match-vp-dialog vp-scale-popover"
        aria-labelledby={titleId}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{match.total} 牌 VP 計分</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="關閉 VP 計分表"
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          {name(match.a)} vs {name(match.b)}
        </p>
        <p>
          {bam
            ? `每牌勝／和／負 ${event.bam?.win ?? 2}／${event.bam?.draw ?? 1}／${event.bam?.loss ?? 0} VP，直接加總`
            : 'WBF 20–0 · 依原訂牌數換算'}
        </p>
        <p>
          {vpA === null || vpB === null
            ? '成績未齊，尚未換算 VP'
            : bam
              ? `${number(vpA)} : ${number(vpB)} VP`
              : match.split
                ? `雙方 IMP 淨差 ${signed(match.marginA)} / ${signed(match.marginB)} → ${number(vpA)} / ${number(vpB)} VP`
                : `${name(match.a)} ${signed(margins[0])} IMP → ${number(vpA)} VP`}
        </p>
        {provisional && <p>暫計成績：依目前已比對成績計算，尚未計入總排名。</p>}
        {scale.length > 0 && (
          <div className="vp-scale-scroll">
            <table aria-label={`${match.total} 牌 VP 換算表`}>
              <thead>
                <tr>
                  <th>IMP 差</th>
                  <th>勝方 VP</th>
                  <th>負方 VP</th>
                </tr>
              </thead>
              <tbody>
                {scale.map((row, index) => (
                  <tr
                    key={row.margin}
                    className={
                      vpA !== null &&
                      vpB !== null &&
                      margins.some((m) => Math.min(Math.abs(m), scale.length - 1) === row.margin)
                        ? 'vp-scale-current'
                        : undefined
                    }
                  >
                    <td>
                      {row.margin}
                      {index === scale.length - 1 ? '+' : ''}
                    </td>
                    <td>{number(row.winner)}</td>
                    <td>{number(row.loser)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {bam && <p>取消牌不給分；收齊後將本場 VP 計入總排名。</p>}
      </dialog>
    </>
  );
}
