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
