import type { PublicEvent } from './model';
import { resultKey } from './model';

// A full trailing round of closing values; missing results break the line.
export function roundMovingAverage(points: readonly { close: number | null }[], boardsPerRound: number) {
  const window = Math.max(1, Math.floor(boardsPerRound));
  return points.map((_, index) => {
    if (index + 1 < window) return null;
    const values = points.slice(index + 1 - window, index + 1).map(p => p.close);
    if (values.some(value => value === null || !Number.isFinite(value))) return null;
    return values.reduce<number>((sum, value) => sum + value!, 0) / window;
  });
}

// Identify common-board movements from the actual schedule, including imported movements.
export function usesCommonBoards(event: Pick<PublicEvent, 'kind' | 'assignments'>) {
  if (event.kind !== 'pairs' || !event.assignments.length) return false;
  const rounds = new Map<number, string>();
  const boardRounds = new Map<number, number>();
  for (const a of event.assignments) {
    if (!a.boards.length) return false;
    const signature = [...a.boards].sort((a, b) => a - b).join(',');
    if (rounds.has(a.round) && rounds.get(a.round) !== signature) return false;
    rounds.set(a.round, signature);
    for (const board of a.boards) {
      if (boardRounds.has(board) && boardRounds.get(board) !== a.round) return false;
      boardRounds.set(board, a.round);
    }
  }
  return true;
}

export function pairScoreHistory(event: PublicEvent, person: string) {
  const mp = (event.pairMethod ?? 'mp') === 'mp';
  let total = 0, top = 0, previous = mp ? 50 : 0;
  return event.assignments
    .filter(a => a.ns === person || a.ew === person)
    .flatMap(a => a.boards.map(board => ({ a, board })))
    .sort((a, b) => a.board - b.board)
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
