import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/domain/event-factory';
import { makeBoard } from '../lib/domain/board-factory';
import { seats, type BridgeEvent } from '../lib/model';
import { createNeonRepository } from '../lib/storage/neon';
import { assignAccessRecords, loadAccessCodes } from '../lib/storage/access-records';
import { seedResultWrites } from '../lib/storage/cell-write';
import { saveStage } from '../lib/storage/rows';
import { project } from '../lib/scoring';
import { createTestDb } from './helpers/sql';
import { DomainError } from '../lib/domain-error';
import {
  accessError,
  approveOrganizer,
  assertOrganizerCanCreate,
  canRevoke,
  defaultExpiry,
  exchangeCode,
  hashSecret,
  issueCode,
  revokeCode,
  type AccessCode,
  type Organizer,
} from '../lib/access/codes';
import { recordAudit, visibleAudits } from '../lib/access/audit';
import { accessLink, consumeAccessFragment } from '../lib/access/fragment';
import { migrateAccessModel } from '../lib/access/migrate';

const now = '2026-11-16T00:00:00.000Z';
const eventDates = { date: '2026-11-17', endDate: '2026-11-18' };

function admin() {
  return issueCode('bootstrap', { name: '站台管理員', scope: 'admin', createdAt: now, secret: 'admin-secret' }).code;
}

test('codes store only hashes and use the default expiries', () => {
  const issued = issueCode('bootstrap', {
    name: '主辦',
    scope: 'organizer',
    organizerId: 'o1',
    createdAt: now,
    secret: 'organizer-secret',
  });
  assert.notEqual(issued.code.hash, 'organizer-secret');
  assert.equal(issued.code.hash, hashSecret('organizer-secret'));
  assert.equal(issued.code.expiresAt, null);
  assert.equal(defaultExpiry('player', undefined), null);
  assert.equal(defaultExpiry('pair', eventDates), '2026-11-18T15:59:59.999Z');
  assert.equal(defaultExpiry('event', eventDates), '2026-11-25T15:59:59.999Z');
});

test('only an active organizer can create events, and referees cannot issue referee codes', () => {
  const owner = admin();
  const pending: Organizer = { id: 'o1', name: '臺北', status: 'pending', createdAt: now };
  const organizer = issueCode(owner, {
    name: '臺北主辦',
    scope: 'organizer',
    organizerId: pending.id,
    createdAt: now,
  }).code;
  assert.throws(() => assertOrganizerCanCreate(organizer, pending), (error: DomainError) => error.code === accessError.organizerPending);
  assert.doesNotThrow(() => assertOrganizerCanCreate(organizer, approveOrganizer(owner, pending)));
  const referee = issueCode(organizer, {
    name: '裁判甲',
    scope: 'event',
    role: 'referee',
    organizerId: 'o1',
    eventId: 'e1',
    createdAt: now,
    event: eventDates,
  }).code;
  assert.throws(
    () => issueCode(referee, { name: '裁判乙', scope: 'event', role: 'referee', organizerId: 'o1', eventId: 'e1', createdAt: now, event: eventDates }),
    (error: DomainError) => error.code === accessError.forbiddenRole,
  );
  const scoring = issueCode(referee, {
    name: '收分',
    scope: 'event',
    role: 'scoring',
    organizerId: 'o1',
    eventId: 'e1',
    createdAt: now,
    event: eventDates,
  }).code;
  assert.equal(scoring.role, 'scoring');
});

test('revocation follows the role matrix and expired or revoked codes cannot sign in', () => {
  const owner = admin();
  const organizer = issueCode(owner, { name: '主辦', scope: 'organizer', organizerId: 'o1', createdAt: now }).code;
  const referee = issueCode(organizer, {
    name: '裁判甲', scope: 'event', role: 'referee', organizerId: 'o1', eventId: 'e1', createdAt: now, event: eventDates,
  }).code;
  const otherReferee = issueCode(organizer, {
    name: '裁判乙', scope: 'event', role: 'referee', organizerId: 'o1', eventId: 'e1', createdAt: now, event: eventDates,
  }).code;
  const scoring = issueCode(referee, {
    name: '收分', scope: 'event', role: 'scoring', organizerId: 'o1', eventId: 'e1', createdAt: now, event: eventDates,
  }).code;
  const reader = issueCode(organizer, {
    name: '唯讀', scope: 'event', role: 'read', organizerId: 'o1', eventId: 'e1', createdAt: now, event: eventDates,
  }).code;
  const pair = issueCode(organizer, {
    name: '北', scope: 'pair', organizerId: 'o1', eventId: 'e1', pairId: 'p1', createdAt: now, event: eventDates,
  }).code;
  const player = issueCode('bootstrap', {
    name: '選手', scope: 'player', playerId: 'player-1', createdAt: now, secret: 'personal',
  }).code;
  assert.equal(canRevoke(owner, otherReferee), true);
  assert.equal(canRevoke(organizer, referee), true);
  assert.equal(canRevoke(organizer, pair), true);
  assert.equal(canRevoke(referee, scoring), true);
  assert.equal(canRevoke(referee, reader), true);
  assert.equal(canRevoke(referee, otherReferee), false);
  assert.equal(canRevoke(referee, pair), false);
  assert.equal(canRevoke(player, player), true);
  assert.equal(canRevoke(player, scoring), false);
  assert.equal(revokeCode(referee, scoring, now).revokedAt, now);
  assert.throws(() => exchangeCode('personal', [{ ...player, revokedAt: now }], new Date(now)), (error: DomainError) => error.code === accessError.codeRevoked);
  const expired: AccessCode = { ...reader, expiresAt: '2026-11-01T00:00:00.000Z' };
  assert.throws(() => exchangeCode('missing', [expired], new Date(now)), (error: DomainError) => error.code === accessError.codeUnknown);
  const known = issueCode('bootstrap', { ...expired, name: '過期', createdAt: now, secret: 'old-code' });
  assert.throws(() => exchangeCode('old-code', [known.code], new Date(now)), (error: DomainError) => error.code === accessError.codeExpired);
});

test('login links keep the code in the fragment and strip it after exchange', () => {
  const link = accessLink('https://valet.example', '/enter', 'abc/def');
  assert.equal(link.includes('?'), false);
  assert.match(link, /#code=abc%2Fdef$/);
  const consumed = consumeAccessFragment(link);
  assert.equal(consumed.secret, 'abc/def');
  assert.equal(consumed.href.includes('code='), false);
  assert.equal(consumeAccessFragment('https://valet.example/enter?code=nope').secret, null);
});

test('migration assigns existing events to 台大橋藝社 without touching deals', () => {
  const event = createEvent({
    name: '11月社內賽',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    date: '2026-11-17',
    venue: '社內',
    rounds: 5,
    boardsPerRound: 3,
  });
  event.id = '58f461bf-e3df-4dab-b5ac-88ba69025f2d';
  event.boards = event.boards.map((board, index) => {
    const dealt = makeBoard(index + 1);
    const north = dealt.deal.N;
    return { ...board, deal: { ...dealt.deal, N: [north[12], ...north.slice(0, 12)] } };
  });
  event.results['keep'] = {
    assignmentId: event.assignments[0].id,
    board: 1,
    level: 1,
    strain: 'NT',
    doubled: 1,
    declarer: 'N',
    tricks: 7,
    lead: '',
    nsScore: 90,
    updatedAt: now,
  };
  event.club = { enabled: true, tokens: { p1: hashSecret('pair-link') }, confirmations: {}, finalized: [] };
  const boards = event.boards;
  const migrated = migrateAccessModel([event], { now, siteAdminSecret: 'new-site-admin', directorSecret: 'director-secret' });
  assert.equal(migrated.events[0].boards, boards);
  assert.equal(migrated.events[0].results, event.results);
  assert.equal(migrated.events[0].club, event.club);
  assert.equal(migrated.events[0].organizerId, 'ntu-bridge-club');
  assert.equal(migrated.organizers[0].name, '台大橋藝社');
  assert.equal(migrated.organizers[0].status, 'active');
  assert.equal(migrated.codes.find((code) => code.scope === 'admin')!.hash, hashSecret('new-site-admin'));
  assert.notEqual(migrated.codes.find((code) => code.scope === 'admin')!.hash, hashSecret('director-secret'));
  assert.equal(migrated.codes.find((code) => code.scope === 'organizer')!.hash, hashSecret('director-secret'));
  assert.equal(migrated.codes.find((code) => code.scope === 'pair')!.hash, event.club.tokens.p1);
  assert.throws(() => migrateAccessModel([event], { now, siteAdminSecret: 'director-secret', directorSecret: 'director-secret' }));
  const adminCode = migrated.codes.find((code) => code.scope === 'admin')!;
  const entry = recordAudit(adminCode, {
    at: now,
    action: '遷移',
    target: event.id,
    before: null,
    after: 'ntu-bridge-club',
    viaAgent: false,
    eventId: event.id,
    organizerId: 'ntu-bridge-club',
  });
  assert.equal(visibleAudits(adminCode, [entry]).length, 1);
  assert.equal(visibleAudits(migrated.codes.find((code) => code.scope === 'organizer')!, [entry]).length, 1);
  const scoring = issueCode(migrated.codes.find((code) => code.scope === 'organizer')!, {
    name: '收分',
    scope: 'event',
    role: 'scoring',
    organizerId: 'ntu-bridge-club',
    eventId: event.id,
    createdAt: now,
    event: { date: event.date, endDate: event.endDate },
  }).code;
  assert.deepEqual(visibleAudits(scoring, [entry]), []);
});

function dealt(event: BridgeEvent) {
  return event.boards.map((board) => seats.map((seat) => board.deal[seat].join('')).join('|'));
}

test('organizer assignment persists through legacy documents and normalized stage settings without changing deals', async () => {
  const secrets = { siteAdminSecret: 'new-site-admin', directorSecret: 'director-secret', now };
  const build = () => {
    const event = createEvent({
      name: '公開遷移',
      kind: 'pairs',
      date: '2026-11-20',
      venue: '測試',
      names: ['甲', '乙', '丙', '丁'],
      rounds: 1,
      boardsPerRound: 2,
    });
    event.boards = event.boards.map((board, index) => {
      const made = makeBoard(board.number);
      if (index === 0) {
        const north = made.deal.N;
        made.deal = { ...made.deal, N: [north[12], ...north.slice(0, 12)] };
      }
      return { ...board, deal: made.deal, dealer: made.dealer, vulnerability: made.vulnerability };
    });
    event.club = { enabled: true, tokens: { p1: hashSecret('pair-link') }, confirmations: {}, finalized: [] };
    return event;
  };

  const legacyDb = await createTestDb();
  try {
    const event = build();
    const repo = createNeonRepository(legacyDb.sql);
    await repo.insertEvent(event);
    const report = await assignAccessRecords(legacyDb.sql, { ...secrets, dryRun: false });
    assert.equal(report.switch, 'legacy');
    assert.equal(report.events, 1);
    assert.ok(report.codes >= 3);
    const read = await repo.getEvent(event.id);
    assert.equal(read.event.organizerId, 'ntu-bridge-club');
    assert.deepEqual(dealt(read.event), dealt(event));
    assert.notEqual(read.event.boards[0].deal.N[0], makeBoard(1).deal.N[0]);
    assert.equal(read.event.club?.tokens.p1, event.club?.tokens.p1);
    const codes = await loadAccessCodes(legacyDb.sql);
    assert.equal(codes.find((code) => code.scope === 'pair')?.hash, event.club?.tokens.p1);
    assert.equal(codes.some((code) => code.hash === secrets.siteAdminSecret), false);
    const again = await assignAccessRecords(legacyDb.sql, { ...secrets, dryRun: false });
    assert.equal(again.events, 0);
    assert.equal(again.codes, 0);
  } finally {
    await legacyDb.close();
  }

  const normalizedDb = await createTestDb();
  try {
    await normalizedDb.sql`UPDATE bridge_storage_switch SET mode = 'normalized', legacy_watermark = '1970-01-01T00:00:00.000Z' WHERE id = 1`;
    const event = build();
    const stored = { event, projection: project(event), requests: [] as string[] };
    await saveStage(normalizedDb.sql, stored, seedResultWrites(event));
    await normalizedDb.sql`INSERT INTO bridge_events (id, revision, document, updated_at)
      VALUES (${event.id}, ${event.revision}, ${JSON.stringify(stored)}::jsonb, '1970-01-01T00:00:00.000Z')`;
    const beforeBoards = await normalizedDb.sql`SELECT document_json FROM bridge_boards WHERE event_id = ${event.id} ORDER BY board_number`;
    const report = await assignAccessRecords(normalizedDb.sql, { ...secrets, dryRun: false });
    assert.equal(report.switch, 'normalized');
    assert.equal(report.legacy, 'untouched');
    const afterBoards = await normalizedDb.sql`SELECT document_json FROM bridge_boards WHERE event_id = ${event.id} ORDER BY board_number`;
    assert.deepEqual(afterBoards, beforeBoards);
    const repo = createNeonRepository(normalizedDb.sql);
    const read = await repo.getEvent(event.id);
    assert.equal(read.event.organizerId, 'ntu-bridge-club');
    assert.deepEqual(dealt(read.event), dealt(event));
    const legacy = await normalizedDb.sql`SELECT document, updated_at::text AS updated_at FROM bridge_events WHERE id = ${event.id}`;
    assert.equal((legacy[0].document as { event: BridgeEvent }).event.organizerId, undefined);
    assert.equal(String(legacy[0].updated_at).startsWith('1970-01-01'), true);
    const again = await assignAccessRecords(normalizedDb.sql, { ...secrets, dryRun: false });
    assert.equal(again.events, 0);
    assert.equal(again.codes, 0);
  } finally {
    await normalizedDb.close();
  }
});
