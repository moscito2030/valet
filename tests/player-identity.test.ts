import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/domain/event-factory';
import { hashSecret } from '../lib/access/codes';
import { makeBoard } from '../lib/domain/board-factory';
import { seats, type BridgeEvent } from '../lib/model';
import { createNeonRepository } from '../lib/storage/neon';
import { seedResultWrites } from '../lib/storage/cell-write';
import { saveStage } from '../lib/storage/rows';
import { loadPlayerRecords, savePlayerRecords } from '../lib/storage/player-records';
import { project } from '../lib/scoring';
import { createTestDb } from './helpers/sql';
import {
  confirmBinding,
  partnerNotices,
  personalPage,
  publicPlayer,
  registerPlayer,
  reissuePlayerCode,
  saveEventFromPairLink,
  suggestBindings,
} from '../lib/access/players';

const now = '2026-11-16T00:00:00.000Z';

test('players register without exposing email, and a replacement code invalidates the old one', () => {
  const registered = registerPlayer({ id: 'player-1', name: '林冠宇', email: 'Lin@example.com', now });
  assert.equal(registered.player.emailKey, hashSecret('lin@example.com'));
  assert.equal('email' in publicPlayer(registered.player), false);
  const sent: string[] = [];
  const replaced = reissuePlayerCode(registered.player, [registered.code], now, { send: (_to, secret) => sent.push(secret) });
  assert.equal(sent[0], replaced.secret);
  assert.notEqual(replaced.player.codeId, registered.code.id);
  assert.equal(replaced.codes.find((code) => code.id === registered.code.id)?.revokedAt, now);
  assert.equal(publicPlayer(replaced.player).name, '林冠宇');
});

test('binding suggests a name match, notifies the other registered partner, and can save a pair-link event', () => {
  const event = createEvent({
    name: '週末賽',
    kind: 'pairs',
    names: ['林冠宇 / 陳思妤', '張哲維 / 王品涵', '李柏翰 / 黃詠晴', '吳承恩 / 劉芷瑜'],
    date: '2026-11-17',
    venue: '臺北',
    rounds: 1,
    boardsPerRound: 1,
  });
  const lin = registerPlayer({ id: 'lin', name: '林冠宇', email: 'lin@example.com', now });
  const chen = registerPlayer({ id: 'chen', name: '陳思妤', email: 'chen@example.com', now });
  const suggestions = suggestBindings(lin.player, event);
  assert.equal(suggestions.length, 1);
  const binding = confirmBinding(suggestions[0]);
  const notices = partnerNotices(lin.player, binding, event, [lin.player, chen.player]);
  assert.deepEqual(notices, [{ playerId: 'chen', eventId: event.id, participantId: binding.participantId, status: 'pending' }]);
  const saved = saveEventFromPairLink(
    lin.player,
    { scope: 'pair', eventId: event.id, pairId: binding.participantId },
    event.id,
    binding.participantId,
  );
  assert.equal(saved.status, 'confirmed');
  assert.throws(() => saveEventFromPairLink(lin.player, { scope: 'pair', eventId: event.id, pairId: 'other' }, event.id, binding.participantId));
  event.results[`${binding.participantId}:1`] = {
    assignmentId: event.assignments.find((assignment) => assignment.ns === binding.participantId || assignment.ew === binding.participantId)!.id,
    board: 1,
    level: 2,
    strain: 'NT',
    doubled: 1,
    declarer: 'N',
    tricks: 8,
    lead: '',
    nsScore: 90,
    updatedAt: now,
  };
  const page = personalPage({ ...lin.player, visibility: 'private' }, [saved], [event], null);
  assert.equal(page, null);
  const own = personalPage({ ...lin.player, visibility: 'private' }, [saved], [event], lin.player.id);
  assert.equal(own?.played[0].results.length, 1);
  assert.equal(event.participants[0].name, '林冠宇 / 陳思妤');
});

function dealt(event: BridgeEvent) {
  return event.boards.map((board) => seats.map((seat) => board.deal[seat].join('')).join('|'));
}

test('a private page reads legacy and normalized events without storing the email or rewriting deals', async () => {
  const lin = registerPlayer({ id: 'lin', name: '林冠宇', email: 'lin@example.com', now });
  const event = createEvent({
    name: '個人頁',
    kind: 'pairs',
    names: ['林冠宇 / 陳思妤', '張哲維 / 王品涵', '李柏翰 / 黃詠晴', '吳承恩 / 劉芷瑜'],
    date: '2026-11-20',
    venue: '測試',
    rounds: 1,
    boardsPerRound: 1,
  });
  const made = makeBoard(1);
  const north = made.deal.N;
  made.deal = { ...made.deal, N: [north[12], ...north.slice(0, 12)] };
  event.boards = [{ ...event.boards[0], deal: made.deal, dealer: made.dealer, vulnerability: made.vulnerability }];
  const binding = {
    playerId: lin.player.id,
    eventId: event.id,
    participantId: event.participants[0].id,
    status: 'confirmed' as const,
  };
  for (const mode of ['legacy', 'normalized'] as const) {
    const db = await createTestDb();
    try {
      if (mode === 'normalized') {
        await saveStage(db.sql, { event, projection: project(event), requests: [] }, seedResultWrites(event));
      } else {
        await createNeonRepository(db.sql).insertEvent(event);
      }
      await savePlayerRecords(db.sql, {
        players: [{ ...lin.player, visibility: 'private' }],
        bindings: [binding],
        notices: [],
      });
      const loaded = await loadPlayerRecords(db.sql);
      assert.equal(loaded.players[0].email, 'lin@example.com');
      assert.equal('email' in publicPlayer(loaded.players[0]), false);
      const stored = await createNeonRepository(db.sql).getEvent(event.id);
      assert.deepEqual(dealt(stored.event), dealt(event));
      assert.equal(personalPage(loaded.players[0], loaded.bindings, [stored.event], null), null);
      const own = personalPage(loaded.players[0], loaded.bindings, [stored.event], lin.player.id);
      assert.equal(own?.player.name, '林冠宇');
      assert.equal('email' in (own?.player ?? {}), false);
      assert.notEqual(stored.event.boards[0].deal.N[0], makeBoard(1).deal.N[0]);
    } finally {
      await db.close();
    }
  }
});
