import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MiniScoreReference } from '../components/mini-score-reference';
test('mini score reference includes the ten legal contracts and standard non-vulnerable scores', () => {
 const html = renderToStaticMarkup(createElement(MiniScoreReference));
 assert.equal((html.match(/<tr/g) ?? []).length,6);
 for(const score of [70,80,90,400,420]) assert.ok(html.includes(`+${score}`));
 assert.match(html,/每少一墩 −50 分/);
 assert.match(html,/一線合約即使取得成局墩數/);
});
