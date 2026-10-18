import type { BridgeEvent, Projection, StoredEvent } from './model';
export type IndexEvent = Pick<
  BridgeEvent,
  | 'stageArchived'
  | 'id'
  | 'name'
  | 'prefix'
  | 'updatedAt'
  | 'kind'
  | 'gameMode'
  | 'pairMethod'
  | 'date'
  | 'endDate'
  | 'venue'
  | 'venueOverride'
  | 'status'
  | 'demo'
  | 'rounds'
  | 'parentEventId'
  | 'stageName'
  | 'hasStages'
  | 'revision'
> & {
  participants: { id: string }[];
  boards: { number: number }[];
};
export type EventIndex = {
  requests?: string[];
  event: IndexEvent;
  projection: Pick<Projection, 'received' | 'expected'>;
};
export function eventIndex(stored: StoredEvent): EventIndex {
  const e = stored.event;
  return {
    event: {
      stageArchived: e.stageArchived,
      id: e.id,
      name: e.name,
      prefix: e.prefix,
      updatedAt: e.updatedAt,
      kind: e.kind,
      gameMode: e.gameMode,
      pairMethod: e.pairMethod,
      date: e.date,
      endDate: e.endDate,
      venue: e.venue,
      venueOverride: e.venueOverride,
      status: e.status,
      demo: e.demo,
      rounds: e.rounds,
      parentEventId: e.parentEventId,
      stageName: e.stageName,
      hasStages: e.hasStages,
      revision: e.revision,
      participants: e.participants.map((p) => ({ id: p.id })),
      boards: e.boards.map((b) => ({ number: b.number })),
    },
    projection: { received: stored.projection.received, expected: stored.projection.expected },
  };
}
