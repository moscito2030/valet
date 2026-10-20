import test from 'node:test';
import assert from 'node:assert/strict';
import { participantResultsLink, resultsSelection } from '../lib/scoreboard-link';

test('scorecard links select the intended participant and round without collection credentials', () => {
  for (const person of ['p15', 't2']) {
    const url = new URL(participantResultsLink('event-a', person, 3), 'https://example.test');
    assert.equal(url.searchParams.get('view'), 'players');
    assert.deepEqual(resultsSelection(url.searchParams, {
      id: 'event-a', rounds: 5, participants: [{ id: person }],
    }), { person, round: 3 });
    assert.deepEqual([...url.searchParams.keys()], ['event', 'view', 'person', 'round']);
  }
});

test('results selection rejects another event and safely handles stale participants and invalid rounds', () => {
  const event = { id: 'a', rounds: 5, participants: [{ id: 'p1' }] };
  assert.equal(resultsSelection(new URLSearchParams('event=b&view=players&person=p1'), event), null);
  for (const round of ['-1', '6', '1.5', 'NaN', '']) {
    assert.deepEqual(resultsSelection(new URLSearchParams(`event=a&view=players&person=gone&round=${round}`), event),
      { person: '', round: 1 });
  }
});
