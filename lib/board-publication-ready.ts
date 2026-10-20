import { boardGroups } from './board-groups';
import { clubAccepted } from './club-confirmation';
import type { Board, BridgeEvent } from './model';
import { roundStartProblem } from './round-workflow';

type PublicationEvent = Pick<
  BridgeEvent,
  | 'boardsPerRound'
  | 'publishBoards'
  | 'assignments'
  | 'results'
  | 'club'
  | 'rounds'
  | 'currentRound'
  | 'participants'
  | 'swiss'
  | 'knockout'
> & { boards: (Omit<Board, 'deal'> & Partial<Pick<Board, 'deal'>>)[] };

/** Suggestions require a complete schedule; absence of future pairings is not completion. */
export function readyBoardGroups(event: PublicationEvent) {
  if (
    Array.from({ length: event.rounds }, (_, i) => i + 1).some((round) =>
      roundStartProblem(event, round),
    )
  )
    return [];
  // A partially imported future round must not look like a complete movement.
  if (
    !event.knockout &&
    Array.from({ length: event.rounds }, (_, i) => i + 1).some(
      round =>
        new Set(event.assignments.filter(a => a.round === round).flatMap(a => [a.ns, a.ew])).size <
        event.participants.length - (event.participants.length % 2),
    )
  ) return [];
  return boardGroups(event.boards, event.boardsPerRound).filter(
    (group) =>
      group.some((board) => !(board.published ?? event.publishBoards)) &&
      group.every((board) => {
        if (!board.deal || Object.values(board.deal).some((hand) => hand.length !== 13))
          return false;
        const uses = event.assignments.filter((a) => a.boards.includes(board.number));
        return (
          uses.length > 0 &&
          uses.every(
            (a) =>
              a.round <= (event.currentRound ?? 0) &&
              !!event.results[`${a.id}:${board.number}`] &&
              (!event.club?.enabled ||
                (event.club.finalized.includes(a.round) && clubAccepted(event, a))),
          )
        );
      }),
  );
}
