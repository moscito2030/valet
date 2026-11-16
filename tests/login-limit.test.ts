import test from 'node:test';
import assert from 'node:assert/strict';
import { nextLoginFailure } from '../lib/login-limit-policy';

test('login limiting counts failures only and a later success can reset the window', () => {
  const start = 1_000_000;
  let window = nextLoginFailure(undefined, start);
  assert.equal(window.blocked, false);
  for (let i = 0; i < 9; i++) window = nextLoginFailure(window, start + i);
  assert.equal(window.count, 10);
  assert.equal(window.blocked, false);
  window = nextLoginFailure(window, start + 20);
  assert.equal(window.blocked, true);
  assert.equal(window.count, 11);
  const expired = nextLoginFailure(window, window.until + 1);
  assert.equal(expired.count, 1);
  assert.equal(expired.blocked, false);
});
