import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeamImpColumns } from '../components/team-imp-columns';
test('team IMP columns distinguish winning side, ties and pending results', () => {
  const render = (value: number | null) => renderToStaticMarkup(createElement(TeamImpColumns, {value}));
  assert.match(render(15), /<span>15<\/span><span class="score-placeholder">—<\/span>/);
  assert.match(render(-15), /<span class="score-placeholder">—<\/span><span>15<\/span>/);
  assert.match(render(0), /aria-label="平手，0 IMP"><span class="score-placeholder">—<\/span><span class="score-placeholder">—<\/span><\/span>/);
  assert.match(render(null), /aria-label="尚未有可比較成績"><\/span>/);
});
