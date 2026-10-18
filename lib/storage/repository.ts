import type { z } from 'zod';
import type { CompetitionDeletion } from '../competition-deletion';
import type { StoredCompetition, competitionUpdateSchema } from '../competition-record';
import type { EventIndex } from '../event-index';
import type { BridgeEvent, Mutation, StoredEvent } from '../model';

// Each mutating operation is atomic, including revision checks and audit/projection updates.
// Implementations may use a local file lock or a database transaction, never a read/write pair in callers.
export interface EventRepository {
  listEvents(): Promise<StoredEvent[]>;
  listEventIndex(): Promise<EventIndex[]>;
  getEvent(id: string): Promise<StoredEvent>;
  deleteEvent(id: string, revision: number): Promise<void>;
  deleteCompetitions(input: CompetitionDeletion): Promise<number>;
  insertEvent(event: BridgeEvent): Promise<StoredEvent>;
  mutateEvent(id: string, command: Mutation): Promise<StoredEvent>;
  listCompetitionRecords(): Promise<StoredCompetition[]>;
  getCompetition(id: string): Promise<StoredCompetition>;
  insertCompetition(stored: StoredCompetition): Promise<StoredCompetition>;
  mutateCompetition(
    id: string,
    input: z.infer<typeof competitionUpdateSchema>,
  ): Promise<StoredCompetition>;
  insertStage(parentId: string, stage: BridgeEvent, revision: number): Promise<StoredEvent>;
}
