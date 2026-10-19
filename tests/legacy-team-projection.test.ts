import assert from 'node:assert/strict';
import test from 'node:test';
import { seedEvents } from '../lib/domain/demo-events';
import { competitionInfo } from '../lib/competitions';
import { hydrateEvent } from '../lib/storage/hydrate-event';
import { project } from '../lib/scoring';

test('legacy team projections are rebuilt from board scores without mutating stored data', () => {
  const stored = seedEvents()[0];
  const expected = project(stored.event);
  for (const match of stored.projection.matches) {
    Reflect.deleteProperty(match, 'marginA');
    Reflect.deleteProperty(match, 'marginB');
    Reflect.deleteProperty(match, 'split');
    match.impsA = 7;
    match.impsB = 74;
    match.vpA = 0;
    match.vpB = 20;
  }
  const before = JSON.stringify(stored);
  const read = hydrateEvent(stored, competitionInfo(stored.event));
  assert.deepEqual(read.projection.matches, expected.matches);
  assert.deepEqual(read.projection.standings, expected.standings);
  assert.equal(JSON.stringify(stored), before);
  assert.equal(read.event.revision, stored.event.revision);
});
