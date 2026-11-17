import test from 'node:test';
import assert from 'node:assert/strict';
import { fitRankLine, rankLineScale } from '../lib/fit-rank-lines';

test('a suit line that fits keeps its slot width and full glyph size', () => {
  assert.deepEqual(fitRankLine(40, 32, 50, 4), { slot: null, scale: 1 });
  assert.equal(rankLineScale(40, 50), 1);
});

test('an overflowing line gives up slot padding before condensing glyphs', () => {
  const fit = fitRankLine(95.4, 75.6, 80, 9);
  assert.equal(fit.scale, 1);
  assert.ok(fit.slot != null);
  assert.ok(fit.slot < 95.4 / 9);
  assert.ok(fit.slot >= 75.6 / 9);
  assert.ok(fit.slot * 9 <= 79.001);
});

test('a 13-card suit scales horizontally only after the gaps are gone', () => {
  const fit = fitRankLine(137.8, 109.2, 80, 13);
  assert.ok(fit.slot != null);
  assert.ok(Math.abs(fit.slot - 109.2 / 13) < 1e-9);
  assert.ok(fit.scale < 1);
  assert.ok(fit.scale * 109.2 <= 79.001);
  assert.equal(fit.scale, rankLineScale(109.2, 79));
});

test('missing glyph width falls back to scaling the natural line', () => {
  const fit = fitRankLine(130, 0, 80, 13);
  assert.equal(fit.slot, null);
  assert.ok(fit.scale < 1);
  assert.ok(fit.scale * 130 <= 79.001);
});

test('a hidden or empty line is left alone', () => {
  assert.deepEqual(fitRankLine(130, 100, 0, 13), { slot: null, scale: 1 });
  assert.deepEqual(fitRankLine(0, 0, 80, 0), { slot: null, scale: 1 });
  assert.equal(rankLineScale(Number.NaN, 40), 1);
});
