import type { AccessCode } from './codes';

export type AccessAudit = {
  at: string;
  actorCodeId: string;
  actorName: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  viaAgent: boolean;
  organizerId?: string;
  eventId?: string;
};

export function recordAudit(
  actor: AccessCode,
  input: Omit<AccessAudit, 'actorCodeId' | 'actorName' | 'organizerId' | 'eventId'> & {
    organizerId?: string;
    eventId?: string;
  },
): AccessAudit {
  return {
    at: input.at,
    actorCodeId: actor.id,
    actorName: actor.name,
    action: input.action,
    target: input.target,
    before: input.before,
    after: input.after,
    viaAgent: input.viaAgent,
    organizerId: input.organizerId ?? actor.organizerId,
    eventId: input.eventId ?? actor.eventId,
  };
}

export function visibleAudits(actor: AccessCode, entries: AccessAudit[]) {
  if (actor.scope === 'admin' && !actor.revokedAt) return entries;
  if (actor.scope === 'organizer' && actor.organizerId)
    return entries.filter((entry) => entry.organizerId === actor.organizerId);
  if (actor.scope === 'event' && actor.role === 'referee' && actor.eventId)
    return entries.filter((entry) => entry.eventId === actor.eventId);
  return [];
}
