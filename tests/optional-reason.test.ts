import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mutationSchema } from '../lib/model';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';

test('score entry and every import accept omitted, blank or one-character explanations', () => {
  const result = { assignmentId: 'a', board: 1, level: 1, strain: 'NT', doubled: 1, declarer: 'N', tricks: 7, lead: '' };
  const payloads = [
    { action: 'results', results: [result] },
    { action: 'ruling', assignmentId: 'a', board: 1, cancelled: true },
    ...['results-import', 'rosters-import', 'lineups-import', 'round-times-import', 'movement'].map(action => ({ action, csv: 'data' })),
    { action: 'pbn', pbn: 'data' },
  ];
  for (const payload of payloads) {
    for (const reason of [undefined, '', '   ', '改']) {
      const command = mutationSchema.parse({ ...payload, revision: 1, requestId: randomUUID(), reason });
      assert.ok(command.reason.length > 0);
      if (reason === '改') assert.equal(command.reason, reason);
    }
    assert.equal(mutationSchema.safeParse({ ...payload, revision: 1, requestId: randomUUID(), reason: 'a'.repeat(201) }).success, false);
  }
});

test('blank explanations retain score changes in the audit trail', () => {
  const event = createEvent({ name: '選填說明', kind: 'pairs', names: ['A','B','C','D'], date: '2026-10-17', venue: '', rounds: 1, boardsPerRound: 1 });
  const a = event.assignments[0];
  const command = mutationSchema.parse({ action: 'results', revision: 1, requestId: randomUUID(), results: [{ assignmentId: a.id, board: 1, level: 1, strain: 'NT', doubled: 1, declarer: 'N', tricks: 7, lead: '' }] });
  const saved = applyMutation({ event, projection: project(event), requests: [] }, command);
  assert.equal(saved.event.audit.at(-1)?.reason, '輸入／更正成績');
  assert.equal(saved.event.audit.at(-1)?.changes?.length, 1);
});
