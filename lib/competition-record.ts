import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Audit, CompetitionInfo, StoredEvent } from './model';
import { DomainError } from './domain-error';

export const competitionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  prefix: z.string().trim().max(80).default(''),
  venue: z.string().trim().max(80).default(''),
}).strict();
export const competitionUpdateSchema = competitionSchema.extend({
  revision: z.number().int().positive(), requestId: z.string().uuid(),
}).strict();
export type StoredCompetition = { competition: CompetitionInfo & { updatedAt: string; audit: Audit[] }; requests: string[] };
export type StoredDocument = StoredEvent | StoredCompetition;
export const isStage = (d: StoredDocument): d is StoredEvent => 'event' in d;
export const competitionKey = (id: string) => `competition:${id}`;
export const documentKey = (d: StoredDocument) => isStage(d) ? d.event.id : competitionKey(d.competition.id);
export const stageCompetitionId = (e: { id: string; parentEventId?: string }) => e.parentEventId ?? e.id;

// Fence concurrent legacy-stage writes when its metadata is first extracted.
// Results, IDs and credentials stay byte-for-byte unchanged.
export function saveCompetitionRecord(data: StoredDocument[], next: StoredCompetition): StoredDocument[] {
  const key = competitionKey(next.competition.id);
  const exists = data.some(d => documentKey(d) === key);
  return [...data.filter(d => documentKey(d) !== key).map(d =>
    !exists && isStage(d) && d.event.id === next.competition.id
      ? { ...d, event: { ...d.event, revision: d.event.revision + 1 } } : d), next];
}

export function createCompetition(input: z.input<typeof competitionSchema>, id: string = randomUUID()): StoredCompetition {
  return { competition: { ...competitionSchema.parse(input), id, hasStages: true, revision: 1, updatedAt: new Date().toISOString(), audit: [] }, requests: [] };
}

// A read-only fallback keeps every legacy event/competition URL valid. The first
// competition write materializes this record without moving or renumbering a stage.
export function findCompetition(data: StoredDocument[], id: string): StoredCompetition {
  const saved = data.find(d => !isStage(d) && d.competition.id === id);
  if (saved && !isStage(saved)) return saved;
  const legacy = data.find(d => isStage(d) && d.event.id === id && !d.event.parentEventId);
  if (!legacy || !isStage(legacy)) throw new DomainError('找不到賽事', 404);
  const e = legacy.event;
  return { competition: { id, name: e.name, prefix: e.prefix ?? '', venue: e.venue, hasStages: true,
    revision: e.revision, updatedAt: e.updatedAt, audit: [] }, requests: [] };
}
export function advanceCompetition(previous: StoredCompetition, revision: number, action: string): StoredCompetition {
  if (previous.competition.revision !== revision) throw new DomainError('賽事已更新，請重新載入', 409);
  const next = structuredClone(previous), at = new Date().toISOString();
  next.competition.revision++;
  next.competition.updatedAt = at;
  next.competition.hasStages = true;
  next.competition.audit.push({ at, action, reason: action, revision: next.competition.revision });
  return next;
}
export function updateCompetition(previous: StoredCompetition, input: z.infer<typeof competitionUpdateSchema>): StoredCompetition {
  if (previous.requests.includes(input.requestId)) return previous;
  const next = advanceCompetition(previous, input.revision, '修改賽事共用資訊');
  Object.assign(next.competition, { name: input.name, prefix: input.prefix, venue: input.venue });
  next.requests = [...previous.requests, input.requestId].slice(-500);
  return next;
}
