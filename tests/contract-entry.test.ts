import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractEntry } from '../components/contract-entry';
import { emptyContractChoice, type ContractChoice } from '../lib/contract-choice';

const render = (choice: ContractChoice) =>
  renderToStaticMarkup(createElement(ContractEntry, { value: choice, onChange() {} }));

function trickSection(html: string) {
  const start = html.indexOf('實得墩數');
  assert.ok(start >= 0);
  return html.slice(start);
}

test('level 7 centre page shows only −2 −1 = and hides the up pager', () => {
  const html = trickSection(render({ ...emptyContractChoice(), level: 7, tricks: 13 }));
  assert.match(html, /data-pager-start="true"/);
  assert.match(html, /data-pager-end="false"/);
  assert.match(html, /class="contract-range"[^>]*>−2…=/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 3);
  assert.match(html, /aria-label="剛好完成，13 墩"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="剛好完成，13 墩"/);
  assert.doesNotMatch(html, /\+1|\+2|不可能|更超/);
  assert.match(html, /aria-label="顯示 −7…−3"/);
  assert.equal((html.match(/disabled/g) ?? []).length, 0);
});

test('level 1 high page stops at 13 tricks and labels only the visible results', () => {
  const html = trickSection(render({ ...emptyContractChoice(), level: 1, tricks: 13 }));
  assert.match(html, /data-pager-start="true"/);
  assert.match(html, /data-pager-end="false"/);
  assert.match(html, /class="contract-range"[^>]*>\+3…\+6/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 4);
  assert.match(html, /aria-label="超 6 墩，13 墩"/);
  assert.match(html, /aria-label="顯示 −2…\+2"/);
  assert.doesNotMatch(html, /\+7|不可能/);
});

test('level 1 centre page keeps five results and both pagers', () => {
  const html = trickSection(render({ ...emptyContractChoice(), level: 1 }));
  assert.match(html, /data-pager-start="true" data-pager-end="true"/);
  assert.match(html, /class="contract-range"[^>]*>−2…\+2/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 5);
  assert.match(html, /aria-label="顯示 \+3…\+6"/);
  assert.match(html, /aria-label="顯示 −7…−3"/);
});

test('a contract without a level still shows the centre page disabled', () => {
  const html = trickSection(render(emptyContractChoice()));
  assert.match(html, /data-pager-start="true" data-pager-end="true"/);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 5);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 7);
  assert.doesNotMatch(html, /contract-range|不可能/);
  assert.match(html, /aria-label="更宕的結果"/);
  assert.match(html, /aria-label="更超的結果"/);
});

async function withEntry(run: (view: {
  render: (element: ReactElement) => Promise<void>;
  root: HTMLElement;
}) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><div id="test-root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const container = dom.window.document.getElementById('test-root')!;
  const root = createRoot(container);
  try {
    await run({
      render: async element => { await act(async () => { root.render(element); }); },
      root: container,
    });
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

function played(doubled: ContractChoice['doubled'] = null): ContractChoice {
  return { ...emptyContractChoice(), level: 4, strain: 'H', declarer: 'S', tricks: 10, doubled };
}

function Harness({ initial }: { initial: ContractChoice }) {
  const [value, setValue] = useState(initial);
  return createElement(ContractEntry, { value, onChange: setValue });
}

function doubleButtons(root: HTMLElement) {
  const row = root.querySelector('.contract-chip-row.doubles');
  assert.ok(row);
  assert.equal(row.getAttribute('role'), 'group');
  assert.equal(row.parentElement?.querySelector('.contract-group-label')?.textContent, '賭倍（選填）');
  const buttons = [...row.querySelectorAll('button')];
  assert.deepEqual(buttons.map((button) => button.textContent), ['賭倍（DBL）', '再賭倍（RDBL）']);
  assert.equal(row.querySelector('[role="radio"]'), null);
  return buttons;
}

test('doubling chips toggle on and off and stay mutually exclusive', async () => {
  await withEntry(async ({ render, root }) => {
    await render(createElement(Harness, { initial: played(null) }));
    let [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'false');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');
    assert.equal(dbl.disabled, false);

    await act(async () => { dbl.click(); });
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'true');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');

    await act(async () => { dbl.click(); });
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'false');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');

    await act(async () => { rdbl.click(); });
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'false');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'true');

    await act(async () => { dbl.click(); });
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'true');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');
  });
});

test('undoubled storage shows neither chip, and Pass or no level disables them', async () => {
  await withEntry(async ({ render, root }) => {
    await render(createElement(Harness, { key: 'plain', initial: played(1) }));
    let [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'false');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');

    await render(createElement(Harness, { key: 'dbl', initial: played(2) }));
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'true');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');

    await render(createElement(Harness, { key: 'rdbl', initial: played(4) }));
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.getAttribute('aria-pressed'), 'false');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'true');

    await render(createElement(Harness, { key: 'empty', initial: emptyContractChoice() }));
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.disabled, true);
    assert.equal(rdbl.disabled, true);
    assert.equal(dbl.getAttribute('aria-pressed'), 'false');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');

    await render(createElement(Harness, { key: 'pass', initial: { ...played(2), level: 0, tricks: null } }));
    [dbl, rdbl] = doubleButtons(root);
    assert.equal(dbl.disabled, true);
    assert.equal(rdbl.disabled, true);
    assert.equal(dbl.getAttribute('aria-pressed'), 'false');
    assert.equal(rdbl.getAttribute('aria-pressed'), 'false');

    await render(createElement(ContractEntry, { value: played(2), onChange: () => {}, showDoubled: false }));
    assert.equal(root.querySelector('.contract-chip-row.doubles'), null);
  });
});
