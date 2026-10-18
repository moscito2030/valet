// Synthetic CPU/serialization profile only: no HTTP, credentials or persistent data.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { audienceEvent } from '../lib/club-view';
import { createEvent } from '../lib/domain/event-factory';
import { resultKey, type Kind } from '../lib/model';
import { applyMutation } from '../lib/mutations/apply';
import { privateBoardPreview } from '../lib/private-board-preview';
import { contractScore, project } from '../lib/scoring';

function measure<T>(operation: () => T) {
  operation();
  const timings = Array.from({ length: 3 }, () => {
    const start = performance.now();
    operation();
    return performance.now() - start;
  });
  return Number(timings.sort((a, b) => a - b)[1].toFixed(2));
}

const report = [];
for (const [kind, participants, rounds, boardsPerRound] of [
  ['teams', 8, 14, 8],
  ['teams', 32, 64, 16],
  ['pairs', 38, 64, 16],
] as [Kind, number, number, number][]) {
  const e = createEvent({
    name: 'Synthetic profile',
    kind,
    date: '2026-10-18',
    venue: '',
    names: Array.from({ length: participants }, (_, i) => `P${i + 1}`),
    rounds,
    boardsPerRound,
  });
  for (const a of e.assignments)
    for (const board of a.boards) {
      const r = {
        assignmentId: a.id,
        board,
        level: 3,
        strain: 'NT' as const,
        doubled: 1 as const,
        declarer: 'N' as const,
        tricks: 8 + (board % 3),
        lead: '',
        updatedAt: e.updatedAt,
      };
      e.results[resultKey(a.id, board)] = {
        ...r,
        nsScore: contractScore(r, e.boards[board - 1].vulnerability),
      };
    }
  e.club = {
    enabled: true,
    mode: 'table',
    tokens: {},
    confirmations: {},
    finalized: Array.from({ length: rounds }, (_, i) => i + 1),
  };
  const projection = project(e),
    stored = { event: e, projection, requests: [] };
  const command = {
    action: 'penalty' as const,
    participantId: e.participants[0].id,
    amount: 1,
    reason: 'Synthetic profile',
    revision: e.revision,
    requestId: randomUUID(),
  };
  const publicSnapshot = audienceEvent(e, projection);
  report.push({
    kind,
    participants,
    rounds,
    boardsPerRound,
    results: Object.keys(e.results).length,
    milliseconds: {
      project: measure(() => project(e)),
      mutation: measure(() => applyMutation(stored, command)),
      publicSnapshot: measure(() => audienceEvent(e, projection)),
      privateBoard: measure(() => privateBoardPreview(e, e.boards[0])),
      serialize: measure(() => JSON.stringify(publicSnapshot)),
    },
    publicBytes: Buffer.byteLength(JSON.stringify(publicSnapshot)),
    storedBytes: Buffer.byteLength(JSON.stringify(stored)),
  });
}
console.log(
  JSON.stringify(
    {
      measurement: 'median of 3 warm CPU runs; excludes network, database and browser rendering',
      report,
    },
    null,
    2,
  ),
);
