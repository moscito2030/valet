import type { Board, BridgeEvent } from '../model';
import { normalizeResults } from '../result-status';
import { project } from '../scoring';

// Only call after director authorization. Never merge this snapshot into public event data.
export function privateBoardPreview(event: BridgeEvent, board: Board) {
  const results = normalizeResults(
    Object.fromEntries(Object.entries(event.results).filter(([, r]) => r.board === board.number)),
  );
  const pairScores =
    event.kind === 'teams'
      ? {}
      : project({
          ...event,
          boards: [board],
          assignments: event.assignments.filter((a) => a.boards.includes(board.number)),
          results,
        }).pairScores;
  return {
    board,
    results,
    pairScores: Object.fromEntries(Object.entries(pairScores).filter(([key]) => key in results)),
  };
}
