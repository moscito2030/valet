import assert from 'node:assert/strict';
import test from 'node:test';
import { seedEvents } from '../lib/domain/demo-events';
import { privateBoardPreview } from '../lib/read-models/private-board';
import { audienceEvent } from '../lib/read-models/public-event';
import { normalizeResults } from '../lib/result-status';
import { project } from '../lib/scoring';

test('public snapshot reuse matches a fresh projection for every publication state', () => {
  for (const { event } of seedEvents())
    for (const finalized of [[], [1], Array.from({ length: event.rounds }, (_, i) => i + 1)]) {
      const e = structuredClone(event);
      e.club = { enabled: true, tokens: { test: 'private-hash' }, confirmations: {}, finalized };
      e.penalties = { [e.participants[0].id]: 2 };
      const before = structuredClone(e),
        projection = project(e);
      const actual = audienceEvent(e, projection),
        expected = audienceEvent(e);
      assert.deepEqual(actual, expected);
      assert.ok(!('club' in actual));
      assert.ok(!('audit' in actual));
      assert.ok(!('requests' in actual));
      assert.ok(
        Object.values(actual.results).every((r) =>
          finalized.includes(e.assignments.find((a) => a.id === r.assignmentId)!.round),
        ),
      );
      assert.deepEqual(e, before);
    }
});

test('a publicly marked deal stays hidden while any scheduled use is unsettled', () => {
  const e = seedEvents()[1].event;
  e.assignments[0].boards.push(e.boards.at(-1)!.number);
  e.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [1] };
  const actual = audienceEvent(e, project(e));
  const board = actual.boards.at(-1)!;
  assert.equal(board.published, false);
  assert.ok(!('deal' in board));
});

test('single-board preview matches full-stage scoring for MP, CrossIMP and Butler including split and cancelled results', () => {
  const e = seedEvents()[1].event,
    board = e.boards[0];
  const results = Object.values(e.results).filter((r) => r.board === board.number);
  results[0].split = { ns: { ...results[0], nsScore: 420 }, ew: { ...results[0], nsScore: 100 } };
  results[1].status = 'cancelled';
  results[2].status = 'average';
  for (const pairMethod of ['mp', 'crossimp', 'butler'] as const)
    for (const trim of ['none', 'one', 'ten-percent'] as const) {
      e.pairMethod = pairMethod;
      e.trim = trim;
      const filtered = Object.fromEntries(
        Object.entries(normalizeResults(e.results)).filter(([, r]) => r.board === board.number),
      );
      const reference = project({ ...e, results: filtered }).pairScores;
      const actual = privateBoardPreview(e, board);
      assert.deepEqual(actual.results, filtered);
      assert.deepEqual(
        actual.pairScores,
        Object.fromEntries(Object.entries(reference).filter(([key]) => key in filtered)),
      );
    }
});
