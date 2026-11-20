import { createNormalizedRepository } from './normalized';
import type { EventRepository } from './repository';
import { requireNormalizedStorage } from './switch';

export type Sql = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>) & {
  // Non-interactive: every statement is fixed before Postgres returns a row.
  // This is the shape of `@neondatabase/serverless` `neon().transaction([...])`.
  transaction?(queries: import('./batch').SqlBatch[]): Promise<Record<string, unknown>[][]>;
  query?(text: string, values?: unknown[]): Promise<unknown>;
};

export function createNeonRepository(query: Sql): EventRepository {
  const normalized = createNormalizedRepository(query);
  async function ready() {
    await requireNormalizedStorage(query);
    return normalized;
  }
  return {
    listEvents: async () => (await ready()).listEvents(),
    listEventIndex: async () => (await ready()).listEventIndex(),
    getEvent: async (id) => (await ready()).getEvent(id),
    deleteEvent: async (id, revision) => (await ready()).deleteEvent(id, revision),
    deleteCompetitions: async (input) => (await ready()).deleteCompetitions(input),
    insertEvent: async (event) => (await ready()).insertEvent(event),
    mutateEvent: async (id, command) => (await ready()).mutateEvent(id, command),
    listCompetitionRecords: async () => (await ready()).listCompetitionRecords(),
    getCompetition: async (id) => (await ready()).getCompetition(id),
    insertCompetition: async (stored) => (await ready()).insertCompetition(stored),
    mutateCompetition: async (id, input) => (await ready()).mutateCompetition(id, input),
    insertStage: async (parentId, stage, revision) => (await ready()).insertStage(parentId, stage, revision),
  };
}
