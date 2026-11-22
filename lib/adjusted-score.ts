import type { AdjustedGrade, Result } from './model';

const impAwards: Record<AdjustedGrade, number> = { 'A+': 3, A: 0, 'A−': -3 };
const mpAwards: Record<AdjustedGrade, number> = { 'A+': 0.6, A: 0.5, 'A−': 0.4 };

function sessionAward(grade: AdjustedGrade, base: number, session = base) {
  if (grade === 'A+') return Math.max(base, session);
  if (grade === 'A−') return Math.min(base, session);
  return base;
}

export function adjustedMatchpoints(grade: AdjustedGrade, top: number, sessionFraction?: number) {
  return top * sessionAward(grade, mpAwards[grade], sessionFraction);
}

export function adjustedImps(grade: AdjustedGrade, sessionAverage?: number) {
  return sessionAward(grade, impAwards[grade], sessionAverage);
}

export function adjustedBam(grade: AdjustedGrade, scale: { win: number; draw: number; loss: number }) {
  return grade === 'A+' ? scale.win : grade === 'A−' ? scale.loss : scale.draw;
}

export function neubergMatchpoints(mp: number, playedTables: number, targetTables: number) {
  return ((mp + 1) * targetTables) / playedTables - 1;
}

export function adjustedLabel(result?: Result) {
  const award = result?.status === 'adjusted' && result.adjusted;
  return award ? `調整分 NS ${award.ns} / EW ${award.ew}` : undefined;
}

// Return the awards in open-room team order, even if entered from the closed room.
export function matchAward(open: Result, closed: Result) {
  if (open.status === 'adjusted' && open.adjusted) return open.adjusted;
  if (closed.status === 'adjusted' && closed.adjusted)
    return { ns: closed.adjusted.ew, ew: closed.adjusted.ns };
}
