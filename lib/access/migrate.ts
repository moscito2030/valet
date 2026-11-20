import type { BridgeEvent } from '../model';
import { hashSecret, type AccessCode, type Organizer } from './codes';

const ntuOrganizerId = 'ntu-bridge-club';

export function migrateAccessModel(
  events: BridgeEvent[],
  input: { now: string; siteAdminSecret: string; directorSecret: string },
) {
  if (!input.siteAdminSecret || input.siteAdminSecret === input.directorSecret)
    throw new Error('站台管理員密碼必須另行設定，且不能與裁判密碼相同');
  const organizer: Organizer = {
    id: ntuOrganizerId,
    name: '台大橋藝社',
    status: 'active',
    createdAt: input.now,
  };
  const admin: AccessCode = {
    id: 'code-admin',
    name: '站台管理員',
    hash: hashSecret(input.siteAdminSecret),
    scope: 'admin',
    issuedBy: 'bootstrap',
    expiresAt: null,
    revokedAt: null,
    createdAt: input.now,
  };
  const director: AccessCode = {
    id: 'code-ntu-organizer',
    name: '台大橋藝社',
    hash: hashSecret(input.directorSecret),
    scope: 'organizer',
    organizerId: organizer.id,
    issuedBy: admin.id,
    expiresAt: null,
    revokedAt: null,
    createdAt: input.now,
  };
  const codes: AccessCode[] = [admin, director];
  for (const event of events) {
    for (const [pairId, hash] of Object.entries(event.club?.tokens ?? {})) {
      codes.push({
        id: `pair-${event.id}-${pairId}`,
        name: pairId,
        hash,
        scope: 'pair',
        organizerId: organizer.id,
        eventId: event.id,
        pairId,
        issuedBy: director.id,
        expiresAt: null,
        revokedAt: null,
        createdAt: input.now,
      });
    }
  }
  const migrated = events.map((event) => ({ ...event, organizerId: event.organizerId ?? organizer.id }));
  return { organizers: [organizer], codes, events: migrated };
}
