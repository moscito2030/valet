import { createHash } from 'node:crypto';
import { clubAccepted, clubConfirmationKey, clubReviewVersion } from './club-confirmation';
import type { BridgeEvent } from './model';
import { canonical } from './storage/cell-write';

export function deriveTableStates(event: BridgeEvent) {
  return event.assignments.map((assignment) => {
    const accepted = clubAccepted(event, assignment);
    const confirmation = accepted
      ? event.club?.confirmations[clubConfirmationKey(event, assignment)]
      : undefined;
    return {
      assignmentId: assignment.id,
      contentHash: createHash('sha256')
        .update(canonical([assignment, clubReviewVersion(event, assignment)]))
        .digest('hex'),
      accepted,
      confirmedAt: confirmation?.at ?? null,
      forced: confirmation?.forced ?? false,
    };
  });
}

type RoundState = 'pending' | 'open' | 'closed' | 'settled';

export function deriveRounds(event: BridgeEvent) {
  const finalized = new Set(event.club?.finalized);
  return Array.from({ length: event.rounds ?? 0 }, (_, index) => {
    const round = index + 1;
    let state: RoundState = 'pending';
    if (finalized.has(round)) state = 'settled';
    else if (round === event.currentRound)
      state = event.status === 'live' && event.roundPhase !== 'break' ? 'open' : 'closed';
    return { round, state };
  });
}
