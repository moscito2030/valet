import type { Board, BridgeEvent, StoredEvent } from './model';

type LegacyEvent = {
  publishBoards?: boolean;
  boards: Board[];
};

// The event-level flag only fills boards that never recorded their own switch.
export function effectiveBoardPublished(
  event: { publishBoards?: boolean },
  board: { published?: boolean },
) {
  return board.published ?? event.publishBoards ?? false;
}

export function materializeBoardPublication<T extends LegacyEvent>(
  event: T,
): Omit<T, 'publishBoards'> {
  const boards = event.boards.map((board) => ({
    ...board,
    published: effectiveBoardPublished(event, board),
  }));
  const next = { ...event, boards };
  delete next.publishBoards;
  return next;
}

// Load-time compatibility. Public reads see only board.published. Disk rows keep
// the old flag until the publication script or the next save.
export function materializeStoredPublication(stored: StoredEvent): StoredEvent {
  const event = stored.event as BridgeEvent & { publishBoards?: boolean };
  if (!Object.prototype.hasOwnProperty.call(event, 'publishBoards')) return stored;
  return { ...stored, event: materializeBoardPublication(event) };
}
