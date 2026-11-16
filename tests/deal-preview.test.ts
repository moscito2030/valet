import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GeneratedDealPreview } from '../components/random-deals-panel';
import { makeBoard } from '../lib/domain/board-factory';

test('generated deal preview renders a hand diagram', () => {
  const boards = [makeBoard(7)];
  const html = renderToStaticMarkup(createElement(GeneratedDealPreview, { boards }));
  assert.match(html, /牌號 7/);
  assert.match(html, /compass-board/);
  assert.match(html, /北家手牌/);
});
