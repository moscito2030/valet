import assert from 'node:assert/strict';
import test from 'node:test';
import {
  refreshButtonHint,
  refreshButtonLabel,
  standingsRefreshFooter,
} from '../components/scoreboard/refresh-copy';
import { createRefreshGesture, LONG_PRESS_MS } from '../components/scoreboard/refresh-gesture';

test('refresh copy follows auto-update state', () => {
  assert.equal(refreshButtonLabel(false, false, false), '手動更新');
  assert.equal(refreshButtonLabel(false, true, false), '自動更新');
  assert.equal(refreshButtonLabel(false, true, true), '手動更新');
  assert.equal(refreshButtonLabel(false, false, true), '手動更新');
  assert.equal(refreshButtonLabel(true, true, false), '更新中');
  assert.equal(refreshButtonLabel(true, false, true), '更新中');
  assert.equal(refreshButtonHint(false), '點一下更新成績，長按切換自動更新。');
  assert.equal(refreshButtonHint(true), '點一下更新成績。此賽事已禁用自動更新。');
  assert.equal(standingsRefreshFooter('live', false, false), '自動更新已關閉');
  assert.equal(standingsRefreshFooter('live', true, false, 15), '成績每 15 秒自動更新');
  assert.equal(standingsRefreshFooter('live', false, true), '此賽事已禁用自動更新');
  assert.equal(standingsRefreshFooter('review', true, false, 30), '成績覆核中 · 如有疑義請向裁判提出更正 · 每 30 秒自動更新');
  assert.equal(standingsRefreshFooter('review', false, false), '成績覆核中 · 如有疑義請向裁判提出更正 · 自動更新已關閉');
  assert.equal(standingsRefreshFooter('finished', true, false), '賽段已結束 · 成績已定案');
  assert.equal(standingsRefreshFooter('finished', false, true), '賽段已結束 · 成績已定案');
});

function gesture(canToggle = true) {
  let now = 0;
  const timers = new Map<unknown, { fn: () => void; at: number }>();
  let nextId = 1;
  const refresh: string[] = [];
  const toggles: number[] = [];
  const g = createRefreshGesture({
    canToggle: () => canToggle,
    onRefresh: () => refresh.push('refresh'),
    onToggle: () => toggles.push(now),
    now: () => now,
    setTimeoutFn: (fn, ms) => {
      const id = nextId++ as unknown as ReturnType<typeof setTimeout>;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeoutFn: (id) => { timers.delete(id); },
  });
  const flush = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  };
  return { g, flush, refresh, toggles, get now() { return now; } };
}

test('a short press refreshes and does not toggle auto-update', () => {
  const t = gesture();
  t.g.pointerDown();
  t.flush(LONG_PRESS_MS - 1);
  t.g.pointerEnd();
  assert.equal(t.g.click(), 'refresh');
  assert.deepEqual(t.refresh, ['refresh']);
  assert.deepEqual(t.toggles, []);
});

test('a long press toggles auto-update and suppresses the following click', () => {
  const t = gesture();
  t.g.pointerDown();
  t.flush(LONG_PRESS_MS);
  assert.deepEqual(t.toggles, [LONG_PRESS_MS]);
  t.g.pointerEnd();
  assert.equal(t.g.click(), 'ignored');
  assert.deepEqual(t.refresh, []);
});

test('a long press does not toggle when auto-update is disabled, and does not refresh on release', () => {
  const t = gesture(false);
  t.g.pointerDown();
  t.flush(LONG_PRESS_MS);
  t.g.pointerEnd();
  assert.deepEqual(t.toggles, []);
  assert.equal(t.g.click(), 'ignored');
  assert.deepEqual(t.refresh, []);
});

test('when auto-update is disabled, a short press still refreshes', () => {
  const t = gesture(false);
  t.g.pointerDown();
  t.flush(100);
  t.g.pointerEnd();
  assert.equal(t.g.click(), 'refresh');
  assert.deepEqual(t.refresh, ['refresh']);
});

test('a cancelled press before the threshold does not toggle or refresh until click', () => {
  const t = gesture();
  t.g.pointerDown();
  t.flush(200);
  t.g.pointerEnd();
  assert.deepEqual(t.toggles, []);
  assert.deepEqual(t.refresh, []);
});
