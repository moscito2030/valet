import type { Assignment } from '@/lib/model';
import { clubAccepted } from '@/lib/club-confirmation';
import { collectionScoreLabel } from '@/lib/collection-score';
import { Contract, type AdminEvent } from './scoreboard-shared';

export function TableScoreReview({ event, assignment: a }: { event: AdminEvent; assignment: Assignment }) {
  const name = (id: string) => event.participants.find(p => p.id === id)?.name ?? id;
  return <div className="table-score-review">
    <p>NS：{name(a.ns)}<br />EW：{name(a.ew)}</p>
    <p className="footnote">{clubAccepted(event, a) ? '本桌已認可' : '本桌尚未確認'} · 僅供後台核對，不會發布成績。</p>
    <div className="table-score-review-list">{a.boards.map(board => {
      const r = event.results[`${a.id}:${board}`];
      const played = r && r.status !== 'cancelled' && r.status !== 'average';
      return <article className="table-score-review-board" key={board}>
        <strong>第 {board} 副</strong>
        <div><Contract result={r} />{played && <>
          <p className="table-score-review-scores">{collectionScoreLabel(r, 'NS')} ／ {collectionScoreLabel(r, 'EW')}</p>
          <small>首引：{r.lead || '未記錄'}</small>
          {r.hcp && <p className="footnote">大牌點：{(['N','E','S','W'] as const).map(s => `${s} ${r.hcp?.[s] ?? '—'}`).join(' ／ ')}</p>}
          {r.split && <div className="footnote">不平衡合約：<br />NS <Contract result={{...r.split.ns, updatedAt:r.updatedAt}} /><br />EW <Contract result={{...r.split.ew, updatedAt:r.updatedAt}} /></div>}
        </>}</div>
      </article>;
    })}</div>
  </div>;
}
