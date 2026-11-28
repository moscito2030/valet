import { knockoutExemptAssignments } from './knockout-status';
import type { Assignment, BridgeEvent, Result } from './model';
import { teamBoardReceived } from './result-status';
import { resultKey } from './model';

// A board counts as soon as a result is stored. In club scoring that is the
// designated input side (NS by default) submitting the board. The other side's
// confirmation is not required, and the count carries no contract or score.
export function enteredBoardCounts(
  event: { assignments: Assignment[]; results: Record<string, unknown> },
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const assignment of event.assignments) {
    let entered = 0;
    for (const board of assignment.boards)
      if (event.results[resultKey(assignment.id, board)]) entered++;
    if (entered) counts[assignment.id] = entered;
  }
  return counts;
}

export function allRoundsComplete(
  event: Pick<BridgeEvent, 'rounds' | 'assignments' | 'results' | 'club'> &
    Partial<Pick<BridgeEvent, 'swiss' | 'participants' | 'knockout'>>,
) {
  if (event.knockout && event.knockout.nodes.some((n) => !event.knockout!.decisions[n.id]))
    return false;
  const exempt = knockoutExemptAssignments(event);
  const entered = enteredBoardCounts(event);
  return (
    event.rounds > 0 &&
    Array.from({ length: event.rounds }, (_, i) => i + 1).every((round) => {
      const tables = event.assignments.filter((a) => a.round === round);
      if (event.knockout && tables.length === 0) return true;
      if (event.swiss) {
        const ids = new Set(tables.flatMap((a) => [a.ns, a.ew]));
        const bye = event.swiss.publications.find((p) => p.round === round && p.bye)?.bye;
        if (bye) ids.add(bye);
        if (!event.participants || ids.size !== event.participants.length) return false;
      }
      return (
        tables.length > 0 &&
        tables.every(
          (a) => exempt.has(a.id) || (a.boards.length > 0 && (entered[a.id] ?? 0) === a.boards.length),
        ) &&
        (!event.club?.enabled || tables.every((a) => exempt.has(a.id) || event.club!.publishedAssignments?.includes(a.id)) || event.club.finalized.includes(round))
      );
    })
  );
}

export function roundProgress(
  event: Pick<BridgeEvent, 'currentRound' | 'assignments' | 'results'> & Partial<Pick<BridgeEvent, 'knockout'>>,
) {
  return collectionProgress(event, enteredBoardCounts(event), knockoutExemptAssignments(event));
}

function collectionProgress(
  event: Pick<BridgeEvent, 'currentRound' | 'assignments'>,
  entered: Record<string, number>,
  exempt: Set<string>,
) {
  const round =
    event.currentRound ||
    Math.max(
      0,
      ...event.assignments.filter((a) => entered[a.id]).map((a) => a.round),
    );
  const tables = event.assignments
    .filter((a) => a.round === round)
    .map((assignment) => {
      const received = entered[assignment.id] ?? 0;
      const expected = exempt.has(assignment.id) ? received : assignment.boards.length;
      return { assignment, received, expected, ratio: expected ? received / expected : 1 };
    });
  const unfinished = tables.filter((table) => table.received < table.expected);
  const lowest = Math.min(...unfinished.map((table) => table.ratio));
  return {
    round,
    received: tables.reduce((sum, table) => sum + table.received, 0),
    expected: tables.reduce((sum, table) => sum + table.expected, 0),
    slowest: unfinished.filter((table) => table.ratio === lowest),
  };
}

export function eventProgress(
  event: Pick<BridgeEvent, 'assignments' | 'currentRound'> & {
    results: Record<string, Pick<Result, 'status'>>;
    knockout?: BridgeEvent['knockout'];
    provisionalVp?: BridgeEvent['provisionalVp'];
  },
  exempt = knockoutExemptAssignments(event),
  pending = new Set(Object.keys(event.provisionalVp ?? {})),
) {
  const enteredBoards = enteredBoardCounts(event);
  const receivedByParticipant: Record<string, number> = {};
  const closedRooms = new Map(event.assignments.filter(a => a.room === 'closed').map(a => [a.matchId, a]));
  for (const a of event.assignments) {
    let played = enteredBoards[a.id] ?? 0;
    if (a.room !== 'pairs') {
      const closed = closedRooms.get(a.matchId);
      if (a.room !== 'open' || !closed) continue;
      played = a.boards.filter(board => {
        const x = event.results[resultKey(a.id, board)], y = event.results[resultKey(closed.id, board)];
        return teamBoardReceived(x, y, pending.has(a.matchId));
      }).length;
    }
    if (played) for (const id of [a.ns, a.ew])
      receivedByParticipant[id] = (receivedByParticipant[id] ?? 0) + played;
  }
  return { enteredBoards, receivedByParticipant, collectionProgress: collectionProgress(event, enteredBoards, exempt) };
}
