import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
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
