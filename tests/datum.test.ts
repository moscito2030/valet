import test from 'node:test';
import assert from 'node:assert/strict';
import { directionalDatum } from '../lib/datum';
import type { Result } from '../lib/model';
import { project } from '../lib/scoring';

const result = (nsScore: number): Result => ({ assignmentId: 'a', board: 1, level: 1, strain: 'NT', doubled: 1, declarer: 'N', tricks: 7, lead: '', nsScore, updatedAt: '' });
test('directional datums retain exact means and round each awarded direction independently', () => {
  const adjusted = { ...result(420), split: { ns: result(620), ew: result(170) } };
  const d = directionalDatum([adjusted, result(400), result(-50), { ...result(999), status: 'cancelled' }]);
  assert.equal(d.valid, 3);
  assert.equal(d.split, true);
  assert.equal(d.ns.mean, 970 / 3);
  assert.equal(d.ew.mean, -520 / 3);
  assert.equal(d.ns.datum, 320);
  assert.equal(d.ew.datum, -170);
});
test('ordinary scores remain symmetric, including half-ten rounding, trimming and empty fields', () => {
  const d = directionalDatum([result(420), result(430)]);
  assert.equal(d.ns.datum, 430);
  assert.equal(d.ew.datum, -430);
  assert.equal(d.split, false);
  assert.equal(directionalDatum([result(-500), result(100), result(200), result(900)], 'one').ns.mean, 150);
  assert.equal(directionalDatum([]).ns.datum, null);
});

test('pair Butler, Cross IMP and MP use independent awarded travellers', () => {
  const participants = ['n1', 'e1', 'n2', 'e2'].map(id => ({ id, name: id, players: '' }));
  const assignments = [1, 2].map(i => ({ id: `a${i}`, round: 1, table: i, room: 'pairs' as const, ns: `n${i}`, ew: `e${i}`, boards: [1], matchId: `m${i}` }));
  const r = { ...result(420), assignmentId: 'a1', split: { ns: result(620), ew: result(170) } };
  for (const [pairMethod, expected] of [['butler', 3], ['crossimp', 6], ['mp', 2]] as const) {
    const p = project({ kind: 'pairs', participants, assignments, boards: [{ number: 1 }], results: { 'a1:1': r, 'a2:1': { ...result(400), assignmentId: 'a2' } }, penalties: {}, pairMethod });
    assert.equal(p.pairScores['a1:1'].ns, expected);
    assert.equal(p.pairScores['a1:1'].ew, expected);
  }
});
