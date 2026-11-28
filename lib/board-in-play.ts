import { knockoutExemptAssignments } from './knockout-status';
import { resultKey, type BridgeEvent } from './model';

type InPlayEvent = Pick<BridgeEvent, 'assignments' | 'results' | 'club' | 'knockout' | 'provisionalVp'>;

// One definition of "this board number is still being played".
// Phone scoring finishes a table when its round is settled, the table is published,
// or a knockout walkover exempts it. Director scoring finishes a table when a result exists.
export function boardsStillInPlay(event: InPlayEvent, runningScore = false) {
  const exempt = knockoutExemptAssignments(event);
  const waiting = new Set<number>();
  if (event.club?.enabled) {
    const finalized = new Set(event.club.finalized ?? []);
    const published = new Set(event.club.publishedAssignments ?? []);
    for (const assignment of event.assignments) {
      if (finalized.has(assignment.round) || published.has(assignment.id) || exempt.has(assignment.id))
        continue;
      for (const board of assignment.boards)
        if (!runningScore || !event.results[resultKey(assignment.id, board)]) waiting.add(board);
    }
    return waiting;
  }
  for (const assignment of event.assignments) {
    // These assignments are historical imports deliberately left open for correction.
    if (exempt.has(assignment.id) || event.provisionalVp?.[assignment.matchId]) continue;
    for (const board of assignment.boards)
      if (!event.results[resultKey(assignment.id, board)]) waiting.add(board);
  }
  return waiting;
}
