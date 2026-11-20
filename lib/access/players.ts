import type { BridgeEvent } from '../model';
import { hashSecret, issueCode, revokeCode, type AccessCode } from './codes';

export type Player = {
  id: string;
  name: string;
  email: string;
  emailKey: string;
  codeId: string;
  visibility: 'public' | 'private';
};

export type PairBinding = {
  playerId: string;
  eventId: string;
  participantId: string;
  status: 'suggested' | 'confirmed';
};

export type PartnerNotice = {
  playerId: string;
  eventId: string;
  participantId: string;
  status: 'pending' | 'confirmed';
};

export type Mailer = { send: (to: string, text: string) => void };

export function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, '').toLowerCase();
}

export function emailKey(email: string) {
  return hashSecret(email.trim().toLowerCase());
}

export function publicPlayer(player: Player) {
  return { id: player.id, name: player.name, visibility: player.visibility };
}

export function registerPlayer(input: { id: string; name: string; email: string; now: string }) {
  const issued = issueCode('bootstrap', {
    id: `player-code-${input.id}`,
    name: input.name,
    scope: 'player',
    playerId: input.id,
    createdAt: input.now,
  });
  const player: Player = {
    id: input.id,
    name: input.name,
    email: input.email.trim(),
    emailKey: emailKey(input.email),
    codeId: issued.code.id,
    visibility: 'public',
  };
  return { player, secret: issued.secret, code: issued.code };
}

export function reissuePlayerCode(player: Player, codes: AccessCode[], now: string, mailer: Mailer) {
  const current = codes.find((code) => code.id === player.codeId);
  if (!current) throw new Error('找不到個人碼');
  const revoked = revokeCode(current, current, now);
  const issued = issueCode('bootstrap', {
    name: player.name,
    scope: 'player',
    playerId: player.id,
    createdAt: now,
  });
  mailer.send(player.email, issued.secret);
  return { player: { ...player, codeId: issued.code.id }, codes: codes.map((code) => (code.id === revoked.id ? revoked : code)).concat(issued.code), secret: issued.secret };
}

export function suggestBindings(player: Player, event: BridgeEvent): PairBinding[] {
  const wanted = normalizeName(player.name);
  return event.participants
    .filter((participant) => participant.name.split(/[/／]/).some((part) => normalizeName(part) === wanted || normalizeName(participant.name) === wanted))
    .map((participant) => ({
      playerId: player.id,
      eventId: event.id,
      participantId: participant.id,
      status: 'suggested' as const,
    }));
}

export function confirmBinding(binding: PairBinding): PairBinding {
  return { ...binding, status: 'confirmed' };
}

export function partnerNotices(player: Player, binding: PairBinding, event: BridgeEvent, players: Player[]): PartnerNotice[] {
  if (binding.status !== 'confirmed' || binding.playerId !== player.id) return [];
  const participant = event.participants.find((item) => item.id === binding.participantId);
  if (!participant) return [];
  const others = participant.name.split(/[/／]/).map((part) => normalizeName(part)).filter((part) => part && part !== normalizeName(player.name));
  return players
    .filter((candidate) => candidate.id !== player.id && others.includes(normalizeName(candidate.name)))
    .map((candidate) => ({
      playerId: candidate.id,
      eventId: event.id,
      participantId: participant.id,
      status: 'pending' as const,
    }));
}

export function saveEventFromPairLink(
  player: Player,
  session: { scope: string; eventId?: string | null; pairId?: string | null },
  eventId: string,
  participantId: string,
): PairBinding {
  if (session.scope !== 'pair' || session.eventId !== eventId || session.pairId !== participantId)
    throw new Error('這張收分連結不能把這場賽事存進個人頁');
  return { playerId: player.id, eventId, participantId, status: 'confirmed' };
}

export function personalPage(
  player: Player,
  bindings: PairBinding[],
  events: BridgeEvent[],
  viewerId: string | null,
) {
  if (player.visibility === 'private' && viewerId !== player.id) return null;
  const played = bindings
    .filter((binding) => binding.playerId === player.id && binding.status === 'confirmed')
    .map((binding) => {
      const event = events.find((item) => item.id === binding.eventId);
      if (!event) return null;
      const results = Object.values(event.results).filter((result) => {
        const assignment = event.assignments.find((item) => item.id === result.assignmentId);
        return assignment?.ns === binding.participantId || assignment?.ew === binding.participantId;
      });
      return { eventId: event.id, name: event.name, participantId: binding.participantId, results };
    })
    .filter((item) => item !== null);
  return { player: publicPlayer(player), played };
}
