import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PairDisplayName } from '../components/pair-display-name';
test('pair display normalizes slash separators without splitting personal names', () => {
 const render = (name:string) => renderToStaticMarkup(createElement(PairDisplayName,{name}));
 assert.equal(render('John Smith / Mary Jones'), 'John Smith<span class="pair-name-separator"> · </span>Mary Jones');
 assert.equal(render('梁昱廷／方予安'), '梁昱廷<span class="pair-name-separator"> · </span>方予安');
 assert.equal(render('John Smith'), 'John Smith');
});
