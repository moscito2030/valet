import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DealExplorer } from '@valet/deal-viewer';
test('shared viewer renders independently of the host JSX configuration', () => {
  const html = renderToStaticMarkup(createElement(DealExplorer, { board: {
    number: 1, dealer: 'N', vulnerability: 'None',
    deal: { N: ['SA'], E: ['HA'], S: ['DA'], W: ['CA'] },
  } }));
  assert.match(html, /compass-board/);
  assert.match(html, /N SA/);
  assert.doesNotMatch(html, /trial-start/);
});

test('MiniBridge table contract uses standard NT notation instead of prose', () => {
  const html = renderToStaticMarkup(createElement(DealExplorer, { board: {
    number: 1, dealer: 'N', vulnerability: 'None', deal: { N: [], E: [], S: [], W: [] },
  }, miniBridge: true, tableSelected: true, result: {
    level: 1, strain: 'NT', doubled: 1, declarer: 'N', tricks: 7, lead: '', nsScore: 90, miniBridge: true,
  } }));
  assert.match(html, /1NT/);
  assert.doesNotMatch(html, /一線|成局/);
});
