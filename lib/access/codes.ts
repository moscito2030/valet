import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain-error';

export const accessError = {
  revisionConflict: 'REVISION_CONFLICT',
  codeRevoked: 'CODE_REVOKED',
  codeExpired: 'CODE_EXPIRED',
  forbiddenRole: 'FORBIDDEN_ROLE',
  codeUnknown: 'CODE_UNKNOWN',
  organizerPending: 'ORGANIZER_PENDING',
} as const;

export type OrganizerStatus = 'pending' | 'active';
export type CodeScope = 'admin' | 'organizer' | 'event' | 'pair' | 'player';
export type EventRole = 'referee' | 'scoring' | 'read';

export type Organizer = {
  id: string;
  name: string;
  status: OrganizerStatus;
  createdAt: string;
};

export type AccessCode = {
  id: string;
  name: string;
  hash: string;
  scope: CodeScope;
  role?: EventRole;
  organizerId?: string;
  eventId?: string;
  pairId?: string;
  playerId?: string;
  issuedBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export function generateSecret() {
  return randomBytes(16).toString('hex');
}

export function secretsMatch(secret: string, hash: string) {
  const actual = hashSecret(secret);
  if (actual.length !== hash.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(hash));
}

const taipeiOffset = '+08:00';

export function endOfTaipeiDay(date: string) {
  return new Date(`${date}T23:59:59.999${taipeiOffset}`).toISOString();
}

function addCalendarDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function defaultExpiry(scope: CodeScope, event: { date: string; endDate?: string } | undefined) {
  if (scope === 'admin' || scope === 'organizer' || scope === 'player') return null;
  const day = event?.endDate || event?.date;
  if (!day) throw new DomainError('賽事缺少日期，不能計算通行碼到期時間', 400, accessError.forbiddenRole);
  if (scope === 'pair') return endOfTaipeiDay(day);
  return endOfTaipeiDay(addCalendarDays(day, 7));
}

export function issueCode(
  actor: AccessCode | 'bootstrap',
  input: Omit<AccessCode, 'id' | 'hash' | 'issuedBy' | 'revokedAt' | 'createdAt' | 'expiresAt'> & {
    id?: string;
    expiresAt?: string | null;
    createdAt: string;
    event?: { date: string; endDate?: string };
    secret?: string;
  },
): { secret: string; code: AccessCode } {
  if (actor !== 'bootstrap') assertCanIssue(actor, input);
  const secret = input.secret ?? generateSecret();
  const code: AccessCode = {
    id: input.id ?? generateSecret().slice(0, 16),
    name: input.name,
    hash: hashSecret(secret),
    scope: input.scope,
    role: input.role,
    organizerId: input.organizerId,
    eventId: input.eventId,
    pairId: input.pairId,
    playerId: input.playerId,
    issuedBy: actor === 'bootstrap' ? 'bootstrap' : actor.id,
    expiresAt: input.expiresAt === undefined ? defaultExpiry(input.scope, input.event) : input.expiresAt,
    revokedAt: null,
    createdAt: input.createdAt,
  };
  return { secret, code };
}

function assertCanIssue(actor: AccessCode, input: { scope: CodeScope; role?: EventRole; organizerId?: string; eventId?: string }) {
  if (actor.revokedAt) throw new DomainError('通行碼已撤銷', 403, accessError.codeRevoked);
  if (input.scope === 'organizer' || input.scope === 'admin') {
    if (actor.scope !== 'admin') throw new DomainError('只有站台管理員能簽發主辦或管理員碼', 403, accessError.forbiddenRole);
    return;
  }
  if (input.scope === 'player') throw new DomainError('個人碼由選手登記時建立', 403, accessError.forbiddenRole);
  if (input.scope === 'event' || input.scope === 'pair') {
    const sameOrganizer = actor.scope === 'admin' || (actor.scope === 'organizer' && actor.organizerId === input.organizerId);
    const referee = actor.scope === 'event' && actor.role === 'referee' && actor.eventId === input.eventId;
    if (input.role === 'referee' && !sameOrganizer)
      throw new DomainError('裁判不能簽發其他裁判碼', 403, accessError.forbiddenRole);
    if (!sameOrganizer && !(referee && input.role !== 'referee'))
      throw new DomainError('不能為這個範圍簽發通行碼', 403, accessError.forbiddenRole);
  }
}

export function exchangeCode(secret: string, codes: AccessCode[], now: Date) {
  const code = findCode(secret, codes);
  if (!code) throw new DomainError('通行碼不存在', 401, accessError.codeUnknown);
  assertUsable(code, now);
  return {
    codeId: code.id,
    name: code.name,
    scope: code.scope,
    role: code.role ?? null,
    organizerId: code.organizerId ?? null,
    eventId: code.eventId ?? null,
    pairId: code.pairId ?? null,
    playerId: code.playerId ?? null,
  };
}

export function findCode(secret: string, codes: AccessCode[]) {
  return codes.find((code) => secretsMatch(secret, code.hash));
}

export function assertUsable(code: AccessCode, now: Date) {
  if (code.revokedAt) throw new DomainError('通行碼已撤銷', 403, accessError.codeRevoked);
  if (code.expiresAt && new Date(code.expiresAt).getTime() <= now.getTime())
    throw new DomainError('通行碼已過期', 403, accessError.codeExpired);
  return code;
}

export function canRevoke(actor: AccessCode, target: AccessCode) {
  if (actor.revokedAt || actor.id === target.id && actor.scope !== 'player') return actor.scope === 'admin';
  if (actor.scope === 'admin') return true;
  if (actor.scope === 'player') return target.scope === 'player' && target.playerId === actor.playerId;
  if (actor.scope === 'organizer' && actor.organizerId) {
    if (target.scope === 'event' && target.issuedBy === actor.id) return true;
    if (target.scope === 'pair' && target.organizerId === actor.organizerId) return true;
    return false;
  }
  if (actor.scope === 'event' && actor.role === 'referee' && actor.eventId === target.eventId)
    return target.scope === 'event' && (target.role === 'scoring' || target.role === 'read');
  return false;
}

export function revokeCode(actor: AccessCode, target: AccessCode, now: string) {
  if (!canRevoke(actor, target)) throw new DomainError('不能撤銷這個通行碼', 403, accessError.forbiddenRole);
  if (target.revokedAt) return target;
  return { ...target, revokedAt: now };
}

export function approveOrganizer(actor: AccessCode, organizer: Organizer): Organizer {
  if (actor.scope !== 'admin' || actor.revokedAt)
    throw new DomainError('只有站台管理員能核可主辦單位', 403, accessError.forbiddenRole);
  return { ...organizer, status: 'active' };
}

export function assertOrganizerCanCreate(actor: AccessCode, organizer: Organizer) {
  assertUsable(actor, new Date());
  if (actor.scope !== 'admin' && !(actor.scope === 'organizer' && actor.organizerId === organizer.id))
    throw new DomainError('不能為這個主辦單位建立賽事', 403, accessError.forbiddenRole);
  if (organizer.status !== 'active')
    throw new DomainError('主辦單位尚未核可', 403, accessError.organizerPending);
}
