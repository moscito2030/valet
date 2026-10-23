import test from 'node:test';
import assert from 'node:assert/strict';
import { formatScore, pairScoreFormat } from '../lib/score-format';
import { ScoreValue } from '../components/score-value';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
test('score formatting preserves units, precision, signs and missing states', () => {
  assert.equal(formatScore(12.7, { unit: 'IMP' }), '12.70 IMP');
  assert.equal(formatScore(50, { unit: '%' }), '50.00 %');
  assert.equal(formatScore(-0.001), '0.00');
  assert.equal(formatScore(2, { signed: true, decimals: 0 }), '+2');
  for (const value of [null, undefined, NaN, Infinity])
    assert.equal(formatScore(value, { unit: '%' }), '—');
  assert.equal(formatScore(2, { unit: 'IMP', showUnit: false }), '2.00');
  assert.equal(pairScoreFormat(0, 0, 'mp').value, null);
  assert.equal(pairScoreFormat(3, 6, 'mp').value, 50);
  assert.equal(pairScoreFormat(3, 6, 'butler').decimals, 0);
});
test('score component has one complete accessible number including its unit', () => {
  const html = renderToStaticMarkup(createElement(ScoreValue, { value: 12.7, unit: '%' }));
  assert.match(html, /aria-label="12.70 %"/);
  assert.match(html, /score-unit/);
  assert.match(html, /compact-imp-fraction/);
  assert.doesNotMatch(
    renderToStaticMarkup(createElement(ScoreValue, { value: null, unit: 'IMP' })),
    /score-unit/,
  );
});
