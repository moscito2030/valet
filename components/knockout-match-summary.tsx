import type { PublicEvent } from '@/lib/model';
import { knockoutLegs, knockoutMatchId, knockoutScore } from '@/lib/knockout';
import { knockoutDecisionLabel } from '@/lib/knockout-report';
import { ScoreValue } from './score-value';

export function KnockoutMatchSummary({ event, matchId }: { event: PublicEvent; matchId?: string }) {
  const ko = event.knockout;
  const node = ko?.nodes.find((n) =>
    knockoutLegs(event, n).some((l) => knockoutMatchId(n.id, l.round) === matchId),
  );
  if (!ko || !node) return null;
  const score = knockoutScore(event, node, event.projection),
    decision = ko.decisions[node.id],
    p = ko.published[node.id];
  const name = (id?: string | null) =>
    event.participants.find((x) => x.id === id)?.name ?? id ?? '';
  const adjustment = ko.adjustments?.[node.id];
  return (
    <div className="knockout-match-summary">
      <strong>
        {node.name} · 累積{event.teamMethod === 'bam' ? ' BAM' : ' IMP 淨差'}
      </strong>
      <p>
        {name(p?.a)}{' '}
        <ScoreValue value={score.a} unit={event.teamMethod === 'bam' ? undefined : 'IMP'} /> :{' '}
        {name(p?.b)}{' '}
        <ScoreValue value={score.b} unit={event.teamMethod === 'bam' ? undefined : 'IMP'} />
      </p>
      {adjustment && (
        <p>
          調整 {adjustment.a} / {adjustment.b}：{adjustment.reason}
        </p>
      )}
      {decision ? (
        <p>
          {knockoutDecisionLabel(decision.method)}
          {decision.winner && ` · 勝方 ${name(decision.winner)}`}：{decision.reason}
        </p>
      ) : (
        <p>{score.complete ? '待裁判確認勝負' : '累積成績未收齊'}</p>
      )}
      {ko.extraLegs?.[node.id]?.map((leg) => (
        <p key={leg.round}>
          加賽：第 {leg.round} 圈，{leg.boards.length} 牌
        </p>
      ))}
    </div>
  );
}
