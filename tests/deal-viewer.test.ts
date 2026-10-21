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

test('corner contract suits request text presentation on mobile browsers', () => {
  for (const [strain, symbol] of [['S', '♠'], ['H', '♥'], ['D', '♦'], ['C', '♣']] as const) {
    const html = renderToStaticMarkup(createElement(DealExplorer, { board: {
      number: 1, dealer: 'N', vulnerability: 'None', deal: { N: [], E: [], S: [], W: [] },
    }, tableSelected: true, result: {
      level: 1, strain, doubled: 1, declarer: 'N', tricks: 7, lead: '', nsScore: 80,
    } }));
    assert.ok(html.includes('1' + symbol + '\uFE0E'), strain + ' must use a text variation selector');
    assert.ok(!html.includes(symbol + '\uFE0F'));
  }
});

 test('DD colors distinguish declarer-side maxima from defensive minima', async () => {
  const { ddIsGreen } = await import('@valet/deal-viewer/play-keyboard');
  for (const declarer of ['N', 'E', 'S', 'W']) {
    for (const turn of ['N', 'E', 'S', 'W']) {
      const sameSide = 'NS'.includes(turn) === 'NS'.includes(declarer);
      assert.deepEqual([7, 8, 9].map(n => ddIsGreen(n, [7, 8, 9], turn, declarer)),
        sameSide ? [false, false, true] : [false, true, true]);
      assert.equal(ddIsGreen(8, [8, 8], turn, declarer), sameSide);
    }
  }
});

test('table-result DD hints show contract outcome and only down tricks are red', async () => {
  const { ddContractOutcome } = await import('@valet/deal-viewer/play-keyboard');
  for (let level = 1; level <= 7; level++) {
    assert.deepEqual(ddContractOutcome(level + 5, level), { text: '-1', green: false });
    assert.deepEqual(ddContractOutcome(level + 6, level), { text: '=', green: true });
    if (level < 7) assert.deepEqual(ddContractOutcome(level + 7, level), { text: '1', green: true });
  }
  assert.deepEqual(ddContractOutcome(7, 4), { text: '-3', green: false });
  assert.deepEqual(ddContractOutcome(12, 3), { text: '3', green: true });
});
