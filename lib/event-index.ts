import type { BridgeEvent, Projection } from './model';
export type IndexEvent = Pick<
  BridgeEvent,
  | 'stageArchived'
  | 'id'
  | 'name'
  | 'updatedAt'
  | 'kind'
  | 'gameMode'
  | 'teamMethod'
  | 'teamFormat'
  | 'bam'
  | 'pairMethod'
  | 'date'
  | 'endDate'
  | 'venue'
  | 'venueOverride'
  | 'organizerId'
  | 'status'
  | 'demo'
  | 'rounds'
  | 'parentEventId'
  | 'stageName'
  | 'stageOrder'
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
export function eventIndex(stored: { event: BridgeEvent; projection: EventIndex['projection']; requests?: string[] }): EventIndex {
  const e = stored.event;
  return {
    event: {
      stageArchived: e.stageArchived,
      id: e.id,
      name: e.name,
      updatedAt: e.updatedAt,
      kind: e.kind,
      gameMode: e.gameMode,
      pairMethod: e.pairMethod,
      teamMethod: e.teamMethod,
      teamFormat: e.knockout ? 'knockout' : e.teamFormat,
      bam: e.bam,
      date: e.date,
      endDate: e.endDate,
      venue: e.venue,
      venueOverride: e.venueOverride,
      organizerId: e.organizerId,
      status: e.status,
      demo: e.demo,
      rounds: e.rounds,
      parentEventId: e.parentEventId,
      stageName: e.stageName,
      stageOrder: e.stageOrder,
      hasStages: e.hasStages,
      revision: e.revision,
      participants: e.participants.map((p) => ({ id: p.id })),
      boards: e.boards.map((b) => ({ number: b.number })),
    },
    projection: { received: stored.projection.received, expected: stored.projection.expected },
  };
}
