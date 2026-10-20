import type { ClubView } from './club-view';

export const followStorageKey = 'bridge-follow';

export function followedParticipant(marker: string, eventId: string, participants: readonly { id: string }[]) {
  const prefix = `${eventId}:`;
  if (!marker.startsWith(prefix)) return '';
  const participantId = marker.slice(prefix.length);
  return participants.some(({ id }) => id === participantId) ? participantId : '';
}

// Call only after the collection API has authenticated the personal link.
// Each page visit gets one attempt so polling cannot undo a manual choice.
export function createClubAutoFollow(write: (key: string, value: string) => void) {
  let handled = false;
  return (view: Pick<ClubView, 'mode' | 'id' | 'pair'>) => {
    if (handled) return;
    handled = true;
    if (view.mode !== 'pair' || !view.id || !view.pair) return;
    try { write(followStorageKey, `${view.id}:${view.pair}`); } catch {
      // Private browsing/storage restrictions must not interrupt score entry.
    }
  };
}
