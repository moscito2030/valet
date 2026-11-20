import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent } from '../lib/domain/event-factory';
import { DomainError } from '../lib/domain-error';
import { applyIdempotent, agentError, auditAgentChange, eventStatus, previewMutation } from '../lib/agent/api';
import { valetMcpTools } from '../lib/agent/mcp';
import { issueCode } from '../lib/access/codes';
import { project } from '../lib/scoring';
import { makeBoard } from '../lib/domain/board-factory';
import { mutationSchema, seats } from '../lib/model';
import { createNeonRepository } from '../lib/storage/neon';
import { createTestDb } from './helpers/sql';

test('agent status, dry run, and idempotency do not apply a preview twice', () => {
  const event = createEvent({
    name: '代理',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-17',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  event.currentRound = 1;
  event.boards[0].published = true;
  const stored = { event, projection: project(event), requests: [] as string[] };
  const status = eventStatus(event);
  assert.equal(status.currentRound, 1);
  assert.equal(status.tablesPending.length > 0, true);
  assert.deepEqual(status.publishedBoards, [1]);
  const assignment = event.assignments[0];
  const command = {
    action: 'results' as const,
    revision: event.revision,
    requestId: randomUUID(),
    reason: '代理試算',
    results: [{
      assignmentId: assignment.id,
      board: assignment.boards[0],
      level: 2,
      strain: 'NT' as const,
      doubled: 1 as const,
      declarer: 'N' as const,
      tricks: 8,
      lead: '',
    }],
  };
  const preview = previewMutation(stored, command);
  assert.equal(preview.alreadyApplied, false);
  assert.equal(preview.changes.length, 1);
  assert.equal(Object.keys(stored.event.results).length, 0);
  const store = new Map<string, number>();
  const first = applyIdempotent(store, 'key-1', () => 1);
  const second = applyIdempotent(store, 'key-1', () => 2);
  assert.equal(first.replayed, false);
  assert.deepEqual(second, { replayed: true, value: 1 });
  const mapped = agentError(new DomainError('賽段版本已更新，請重新載入後再提交。', 409, 'stage-revision'));
  assert.equal(mapped.code, 'REVISION_CONFLICT');
  const actor = issueCode('bootstrap', {
    name: '收分代理',
    scope: 'event',
    role: 'scoring',
    eventId: event.id,
    createdAt: event.updatedAt,
    event: { date: event.date },
  }).code;
  assert.equal(auditAgentChange(actor, event.updatedAt, preview.changes[0].target, null, preview.changes[0].after).viaAgent, true);
  assert.deepEqual(valetMcpTools.map((tool) => tool.name), ['valet_event_status', 'valet_preview_mutation', 'valet_apply_mutation']);
});

test('a dry run leaves both stores unchanged, and one request id applies once', async () => {
  for (const mode of ['legacy', 'normalized'] as const) {
    const db = await createTestDb();
    try {
      if (mode === 'normalized') {
        await db.sql`UPDATE bridge_storage_switch SET mode = 'normalized', legacy_watermark = '1970-01-01T00:00:00.000Z' WHERE id = 1`;
      }
      const event = createEvent({
        name: '代理儲存',
        kind: 'pairs',
        names: ['甲', '乙', '丙', '丁'],
        date: '2026-11-20',
        venue: '測試',
        rounds: 1,
        boardsPerRound: 1,
      });
      const made = makeBoard(1);
      const north = made.deal.N;
      made.deal = { ...made.deal, N: [north[12], ...north.slice(0, 12)] };
      event.boards = [{ ...event.boards[0], ...made, published: true }];
      event.currentRound = 1;
      const repo = createNeonRepository(db.sql);
      await repo.insertEvent(event);
      const loaded = await repo.getEvent(event.id);
      const before = seats.map((seat) => loaded.event.boards[0].deal[seat].join('')).join('|');
      const command = mutationSchema.parse({
        action: 'results',
        revision: loaded.event.revision,
        requestId: randomUUID(),
        reason: '代理試算',
        results: [{
          assignmentId: loaded.event.assignments[0].id,
          board: loaded.event.assignments[0].boards[0],
          level: 2,
          strain: 'NT',
          doubled: 1,
          declarer: 'N',
          tricks: 8,
          lead: '',
        }],
      });
      const preview = previewMutation(loaded, command);
      assert.equal(preview.changes.length, 1);
      const untouched = await repo.getEvent(event.id);
      assert.equal(Object.keys(untouched.event.results).length, 0);
      assert.equal(seats.map((seat) => untouched.event.boards[0].deal[seat].join('')).join('|'), before);
      assert.deepEqual(eventStatus(untouched.event).publishedBoards, [1]);
      await repo.mutateEvent(event.id, command);
      const replay = await repo.mutateEvent(event.id, command);
      assert.equal(replay.event.results[Object.keys(replay.event.results)[0]].tricks, 8);
      assert.equal(Object.keys(replay.event.results).length, 1);
      assert.notEqual(replay.event.boards[0].deal.N[0], makeBoard(1).deal.N[0]);
    } finally {
      await db.close();
    }
  }
});
