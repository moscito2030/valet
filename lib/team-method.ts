import type { BridgeEvent, Result } from './model';
export const defaultBam = { win: 2, draw: 1, loss: 0 };
export type TeamScoring = Pick<BridgeEvent, 'teamMethod' | 'bam'>;
export function bamBoardPoints(
  open: Result,
  closed: Result,
  scoring: TeamScoring,
): [number, number] {
  const scale = scoring.bam ?? defaultBam;
  if ([open, closed].some((r) => r.status === 'cancelled' || r.status === 'average')) return [0, 0];
  const raw = (r: Result, side: 'ns' | 'ew') => r.split?.[side].nsScore ?? r.nsScore;
  const points = (difference: number) =>
    difference > 0 ? scale.win : difference < 0 ? scale.loss : scale.draw;
  return [points(raw(open, 'ns') - raw(closed, 'ew')), points(raw(closed, 'ns') - raw(open, 'ew'))];
}
export function teamScoringLabel(event: TeamScoring) {
  const s = event.bam ?? defaultBam;
  return event.teamMethod === 'bam'
    ? `Board-A-Match · 勝／和／負 ${s.win}／${s.draw}／${s.loss} VP`
    : 'IMP · WBF 20–0 VP';
}
