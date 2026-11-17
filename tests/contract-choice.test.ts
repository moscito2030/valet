import test from 'node:test';
import assert from 'node:assert/strict';
import { contractScore } from '../lib/scoring';
import {
  canShiftTricks,
  emptyContractChoice,
  emptyScoreForm,
  formatDelta,
  formatDeltaSpan,
  pageForDelta,
  parsedResult,
  possibleDeltas,
  scoreFormFromResult,
  storedContract,
  trickDeltas,
  trickRange,
  tricksForDelta,
} from '../lib/contract-choice';
import type { ResultInput } from '../lib/model';

const base = { assignmentId: 'a1', board: 3, lead: '' };

test('a new contract choice stores nothing until every part is chosen', () => {
  const choice = emptyContractChoice();
  assert.equal(storedContract(choice), null);
  assert.equal(storedContract({ ...choice, level: 1 }), null);
  assert.equal(storedContract({ ...choice, level: 1, strain: 'C', doubled: 1, declarer: 'N' }), null);
  assert.equal(parsedResult(emptyScoreForm('a1', 3)), null);
});

test('Pass alone is a complete board and keeps a stored Pass unchanged', () => {
  const fresh = storedContract({ ...emptyContractChoice(), level: 0 });
  assert.deepEqual(fresh, { level: 0, strain: 'NT', doubled: 1, declarer: 'N', tricks: 0, lead: '' });
  const saved = scoreFormFromResult({
    ...base,
    level: 0,
    strain: 'C',
    doubled: 1,
    declarer: 'S',
    tricks: 0,
  });
  assert.equal(saved.choice.level, 0);
  assert.equal(saved.choice.strain, null);
  assert.equal(saved.choice.declarer, null);
  assert.deepEqual(storedContract(saved.choice, { passDefaults: saved.passDefaults }), {
    level: 0,
    strain: 'C',
    doubled: 1,
    declarer: 'S',
    tricks: 0,
    lead: '',
  });
  const chosen = storedContract(
    { ...saved.choice, strain: 'H', declarer: 'E' },
    { passDefaults: saved.passDefaults },
  );
  assert.equal(chosen?.strain, 'H');
  assert.equal(chosen?.declarer, 'E');
});

test('a complete contract round-trips without inventing fields', () => {
  const played: ResultInput = { ...base, level: 1, strain: 'C', doubled: 1, declarer: 'N', tricks: 7, lead: 'S2' };
  const form = scoreFormFromResult(played);
  assert.deepEqual(parsedResult(form), played);
  assert.equal(contractScore(parsedResult(form)!, 'None'), 70);
  assert.equal(parsedResult({ ...form, choice: { ...form.choice, doubled: null } }), null);
});

test('trick pages stay centred on contract and stop at 0 and 13 tricks', () => {
  assert.deepEqual(trickDeltas(0), [-2, -1, 0, 1, 2]);
  assert.deepEqual(trickDeltas(-1), [-7, -6, -5, -4, -3]);
  assert.deepEqual(trickDeltas(1), [3, 4, 5, 6, 7]);
  assert.deepEqual(trickDeltas(2), [8, 9, 10, 11, 12]);
  assert.equal(formatDelta(0), '=');
  assert.equal(formatDelta(-2), '−2');
  assert.equal(formatDelta(2), '+2');
  assert.equal(formatDeltaSpan(possibleDeltas(1, 1)), '+3…+6');
  assert.deepEqual(possibleDeltas(7, 0), [-2, -1, 0]);
  assert.equal(canShiftTricks(7, 0, 1), false);
  assert.equal(canShiftTricks(7, 0, -1), true);
  assert.equal(canShiftTricks(1, 0, 1), true);
  assert.equal(canShiftTricks(1, 1, 1), false);
  assert.equal(canShiftTricks(1, -1, -1), false);
  assert.equal(canShiftTricks(null, 0, -1), false);
  assert.equal(tricksForDelta(1, 0), 7);
  assert.equal(tricksForDelta(4, -10), 0);
  assert.equal(pageForDelta(0), 0);
  assert.equal(pageForDelta(-7), -1);
  assert.equal(pageForDelta(-8), -2);
  assert.equal(pageForDelta(3), 1);
  assert.equal(pageForDelta(8), 2);
  assert.deepEqual(trickRange(4, 0, 13), { window: '−2…+2', held: '+3' });
  assert.deepEqual(trickRange(4, 1, 13), { window: '+3', held: null });
  assert.deepEqual(trickRange(null, 0, null), { window: '', held: null });
  assert.deepEqual(trickRange(7, 0, null), { window: '−2…=', held: null });
  assert.deepEqual(possibleDeltas(7, -3), [-13]);
  assert.deepEqual(trickRange(7, -3, 0), { window: '−13', held: null });
  assert.equal(canShiftTricks(7, -3, -1), false);
  assert.deepEqual(possibleDeltas(1, 0), [-2, -1, 0, 1, 2]);
  assert.deepEqual(trickRange(1, 0, null), { window: '−2…+2', held: null });
  assert.deepEqual(possibleDeltas(1, 1), [3, 4, 5, 6]);
  assert.deepEqual(trickRange(1, 1, null), { window: '+3…+6', held: null });
  assert.deepEqual(trickRange(1, 1, 7), { window: '+3…+6', held: '=' });
});
