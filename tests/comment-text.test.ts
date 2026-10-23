import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommentText } from '../components/comment-text';
const render = (text: string) => renderToStaticMarkup(createElement(CommentText, { text }));
test('comment suit shorthand handles case, contracts, holdings and adjacent tokens', () => {
  const result = render('4!S !hAKQ !d!c\n!x');
  assert.equal((result.match(/role="img"/g) ?? []).length, 4);
  assert.equal((result.match(/discussion-suit-red/g) ?? []).length, 2);
  assert.match(result, /4<span/);
  assert.ok(result.includes('♠\uFE0E'));
  assert.ok(result.includes('♥\uFE0E'));
  assert.match(result, /<\/span>AKQ/);
  assert.ok(result.endsWith('\n!x'));
  assert.match(result, /aria-label="梅花"/);
  assert.equal(render('♠ ♥ ♦ ♣'), '♠ ♥ ♦ ♣');
});
test('comment text and shorthand never execute HTML or escape user text', () => {
  const result = render('<img src=x onerror=alert(1)> !h & <script>evil</script>');
  assert.ok(!result.includes('<img'));
  assert.ok(!result.includes('<script>'));
  assert.match(result, /&lt;img/);
  assert.match(result, /&amp;/);
  assert.match(result, /♥/);
  assert.equal(render(''), '');
});
