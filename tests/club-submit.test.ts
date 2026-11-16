import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isStageRevisionConflict, resultUpdatedAt, staleClubResult } from '../lib/club-submit';
import { DomainError } from '../lib/domain-error';
import { createEvent } from '../lib/domain/event-factory';
import { applyMutation } from '../lib/mutations/apply';
import { mutationSchema, resultKey } from '../lib/model';
import { project } from '../lib/scoring';

test('phone retries treat only an unchanged score cell as safe to resend', () => {
  assert.equal(staleClubResult(undefined, undefined), false);
  assert.equal(staleClubResult('', undefined), false);
  assert.equal(staleClubResult('', ''), false);
  assert.equal(staleClubResult('2026-11-16T00:00:00.000Z', '2026-11-16T00:00:00.000Z'), false);
  assert.equal(staleClubResult('2026-11-16T00:00:01.000Z', '2026-11-16T00:00:00.000Z'), true);
  assert.equal(staleClubResult('2026-11-16T00:00:00.000Z', ''), true);
  const event = createEvent({
    name: '收分重試',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-16',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  const assignment = event.assignments[0];
  event.results[resultKey(assignment.id, assignment.boards[0])] = {
    assignmentId: assignment.id,
    board: assignment.boards[0],
    level: 1,
    strain: 'NT',
    doubled: 1,
    declarer: 'N',
    tricks: 7,
    lead: '',
    nsScore: 90,
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
  assert.equal(
    resultUpdatedAt(event, { assignmentId: assignment.id, board: assignment.boards[0] }),
    '2026-11-16T00:00:00.000Z',
  );
  assert.equal(resultUpdatedAt(event, { assignmentId: assignment.id, board: 99 }), '');
  assert.equal(resultUpdatedAt(event), undefined);
});

test('a stale section revision is retryable and a settled-table rejection is not', () => {
  const event = createEvent({
    name: '收分重試',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-16',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  const stored = { event, projection: project(event), requests: [] };
  const command = mutationSchema.parse({
    action: 'penalty',
    participantId: event.participants[0].id,
    amount: 1,
    revision: event.revision + 5,
    requestId: randomUUID(),
    reason: '版本衝突',
  });
  assert.throws(() => applyMutation(stored, command), isStageRevisionConflict);
  const settled = new DomainError('本桌已結算，不開放裝置輸入', 409);
  assert.equal(isStageRevisionConflict(settled), false);
  assert.equal(isStageRevisionConflict(new DomainError('賽段版本已更新，請重新載入後再提交。', 409)), false);
});
