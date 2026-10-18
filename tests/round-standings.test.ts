import test from 'node:test';
import assert from 'node:assert/strict';
import { project, pairStandingsBeforeRound, teamStandingsThroughRound } from '../lib/scoring';
import { createEvent } from '../lib/events';
import { resultKey, type Result } from '../lib/model';

test('pairs pre-round scores and ranks exclude this and later rounds for MP, CrossIMP and Butler', () => {
  for (const pairMethod of ['mp', 'crossimp', 'butler'] as const) {
    const event = createEvent({ name: 'pre-round', kind: 'pairs', names: ['A', 'B', 'C', 'D'], rounds: 2, boardsPerRound: 1, date: '2026-10-16', venue: '' });
    event.pairMethod = pairMethod;
    event.trim = 'none';
    event.assignments = [1, 2].flatMap(round => [0, 1].map(i => ({ id: `${round}-${i}`, round, table: i + 1, room: 'pairs' as const, ns: event.participants[i * 2].id, ew: event.participants[i * 2 + 1].id, boards: [1], matchId: `${round}-${i}` })));
    event.results = Object.fromEntries(event.assignments.map((a, i) => [resultKey(a.id, 1), { assignmentId: a.id, board: 1, level: 4, strain: 'H', doubled: 1, declarer: 'N', tricks: 10, lead: '', nsScore: [420, 170, -1100, 1100][i], updatedAt: '' } as Result]));
    assert.ok(pairStandingsBeforeRound(event, 1).every(row => row.score === (pairMethod === 'mp' ? 50 : 0) && row.played === 0));
    const beforeSecond = pairStandingsBeforeRound(event, 2);
    const first = beforeSecond.find(row => row.id === event.participants[0].id)!;
    assert.equal(first.score, { mp: 100, crossimp: 6, butler: 3 }[pairMethod]);
    assert.equal(first.played, 1);
    event.penalties = { [event.participants[0].id]: 1000 };
    assert.deepEqual(pairStandingsBeforeRound(event, 2), beforeSecond);
    // Later scores for the same board must not alter either the comparison pool or ranks.
    event.results['2-0:1'].nsScore = 7600;
    assert.deepEqual(pairStandingsBeforeRound(event, 2), beforeSecond);
    assert.notDeepEqual(pairStandingsBeforeRound(event, 3), beforeSecond);
  }
});

test('round VP and ranks exclude later and incomplete matches', () => {
  const event = {
    participants: ['a', 'b'].map(id => ({ id, name: id, players: '' })),
    penalties: { a: 0.2 },
    projection: { standings: [], pairScores: {}, received: 0, expected: 0, matches:
      [ [1, 8, 12], [2, 20, 0], [3, null, null] ].map(([round, vpA, vpB]) => ({
        id: String(round), round: round!, a: 'a', b: 'b', impsA: 0, impsB: 0, marginA: 0, marginB: 0, split: false, completed: 0, total: 8, vpA, vpB,
      })),
    },
  };
  assert.deepEqual(teamStandingsThroughRound(event, 1).map(r => [r.id, r.score, r.rank]), [['b', 12, 1], ['a', 8, 2]]);
  assert.deepEqual(teamStandingsThroughRound(event, 2).map(r => [r.id, r.score, r.rank]), [['a', 28, 1], ['b', 12, 2]]);
  assert.deepEqual(teamStandingsThroughRound(event, 3), teamStandingsThroughRound(event, 2));
});

test('team round scores and ranks ignore penalties even when penalties would reverse ranks', () => {
  const event = createEvent({ name: 'penalty-scope', kind: 'teams', names: ['A','B','C','D'], rounds: 1, boardsPerRound: 1, date: '2026-10-17', venue: '' });
  event.results = Object.fromEntries(event.assignments.map(a => [resultKey(a.id, 1), { assignmentId:a.id, board:1, level:0, strain:'NT', doubled:1, declarer:'N', tricks:0, lead:'', nsScore:0, updatedAt:'' } as Result]));
  const baseline = project(event);
  const round = teamStandingsThroughRound({...event, projection:baseline}, 1);
  event.penalties = { [event.participants[0].id]: 5 };
  const penalized = project(event);
  assert.deepEqual(teamStandingsThroughRound({...event, projection:penalized}, 1), round);
  assert.deepEqual(penalized.matches, baseline.matches);
  const id = event.participants[0].id;
  assert.equal(penalized.standings.find(s=>s.id===id)!.score, baseline.standings.find(s=>s.id===id)!.score! - 5);
  assert.equal(penalized.standings.find(s=>s.id===id)!.rank, 4);
});
