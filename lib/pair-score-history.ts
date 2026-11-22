import { isPlayed } from './result-status';
import type { PublicEvent } from './model';
import { resultKey } from './model';
import { directionalDatum } from './datum';
import { awardedResult, imps } from './scoring';

export function boardButlerVolume(event: PublicEvent, board: number) {
  const assignments = event.assignments.filter(a => a.boards.includes(board));
  const results = assignments.map(a => event.results[resultKey(a.id, board)]);
  const valid = results.filter(r => isPlayed(r));
  const datum = directionalDatum(valid, event.pairMethod === 'butler' ? event.trim : 'none');
  const value = valid.length ? valid.reduce((total, result) => total + (
    Math.abs(imps(awardedResult(result, 'ns')!.nsScore - datum.ns.datum!)) +
    Math.abs(imps(-awardedResult(result, 'ew')!.nsScore - datum.ew.datum!))
  ) / 2, 0) : null;
  const spread = valid.length ? Math.max(...(['ns', 'ew'] as const).map(side => {
    const scores = valid.map(result => imps(
      awardedResult(result, side)!.nsScore * (side === 'ns' ? 1 : -1) - datum[side].datum!,
    ));
    return Math.max(...scores) - Math.min(...scores);
  })) : null;
  return { value, spread, tables: valid.length, provisional: results.some(r => !r) };
}

export function pairScoreHistory(event: PublicEvent, person: string) {
  const mp = (event.pairMethod ?? 'mp') === 'mp';
  let total = 0, top = 0, previous = mp ? 50 : 0;
  return event.assignments
    .filter(a => a.ns === person || a.ew === person)
    .flatMap(a => a.boards.map(board => ({ a, board })))
    // Follow the round this pair played the board, then board number. Common-board
    // schedules give every table the same ascending boards each round, so this
    // matches sorting by board number alone.
    .sort((x, y) => x.a.round - y.a.round || x.board - y.board)
    .map(({ a, board }) => {
      const score = event.projection.pairScores[resultKey(a.id, board)];
      const value = score ? (a.ns === person ? score.ns : score.ew) : null;
      const valid = value != null && Number.isFinite(value) && !score.cancelled && (!mp || score.top > 0);
      const open = previous;
      const field = event.assignments.filter(other => other.boards.includes(board))
        .map(other => event.projection.pairScores[resultKey(other.id, board)])
        .filter(other => other && !other.cancelled && (!mp || other.top > 0))
        .flatMap(other => {
          const candidate = a.ns === person ? other.ns : other.ew;
          return candidate == null || !Number.isFinite(candidate) ? [] :
            [mp ? 100 * (total + candidate) / (top + other.top) : total + candidate];
        });
      if (valid) {
        total += value;
        top += mp ? score.top : 1;
        previous = mp ? 100 * total / top : total;
      }
      return {
        board, round: a.round, open,
        close: valid || score?.cancelled ? previous : null,
        low: valid || score?.cancelled ? field.length ? Math.min(...field) : previous : null,
        high: valid || score?.cancelled ? field.length ? Math.max(...field) : previous : null,
        provisional: score?.provisional ?? false,
        cancelled: score?.cancelled ?? false,
      };
    });
}
