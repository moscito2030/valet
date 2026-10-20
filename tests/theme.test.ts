import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const script = readFileSync('public/theme.js', 'utf8');
function boot(saved: string | null, dark = false, blocked = false) {
  const listeners: Record<string, (event: any) => void> = {};
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  const media = { matches: dark, addEventListener: (_: string, callback: () => void) => { listeners.media = callback; } };
  runInNewContext(script, {
    document: { documentElement: root },
    window: { dispatchEvent() {}, addEventListener: (name: string, callback: (e: any) => void) => { listeners[name] = callback; } },
    matchMedia: () => media,
    localStorage: { getItem() { if (blocked) throw new Error('blocked'); return saved; } },
    customElements: { get: () => undefined, define() {} }, HTMLElement: class {}, Event: class {},
  });
  return { root, media, listeners };
}
test('appearance restores only known themes and survives unavailable storage', () => {
  for (const name of ['forest', 'light', 'sepia', 'nord', 'dracula']) {
    const { root } = boot(name);
    assert.equal(root.dataset.theme, name);
    assert.equal(root.style.colorScheme, ['nord', 'dracula'].includes(name) ? 'dark' : 'light');
  }
  assert.equal(boot('untrusted-value').root.dataset.theme, 'forest');
  assert.equal(boot(null, true, true).root.dataset.theme, 'forest');
});
test('system preference follows live changes but explicit themes stay selected', () => {
  const system = boot('system', true);
  assert.equal(system.root.dataset.theme, 'nord');
  system.media.matches = false; system.listeners.media({});
  assert.equal(system.root.dataset.theme, 'forest');
  const explicit = boot('dracula');
  explicit.media.matches = true; explicit.listeners.media({});
  assert.equal(explicit.root.dataset.theme, 'dracula');
});
test('another tab can update or clear the preference without unrelated storage interference', () => {
  const { root, listeners } = boot('nord');
  listeners.storage({ key: 'other', newValue: 'light' });
  assert.equal(root.dataset.theme, 'nord');
  listeners.storage({ key: 'valet-theme', newValue: 'sepia' });
  assert.equal(root.dataset.theme, 'sepia');
  listeners.storage({ key: 'valet-theme', newValue: null });
  assert.equal(root.dataset.theme, 'forest');
});

const luminance = (hex: string) => {
  const values = hex.replace('#', '').match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
};
test('new themes keep normal text and score colors readable on their surfaces', () => {
  const css = readFileSync('public/theme-colors.css', 'utf8');
  for (const [, name, block] of css.matchAll(/:root\[data-theme="([^"]+)"\]\s*\{([^}]+)\}/g)) {
    const colors = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/g)].map(m => [m[1], m[2]]));
    for (const bg of ['surface-bg', 'page-bg', 'surface-soft']) {
      for (const fg of ['text-primary', 'text-muted', 'team-home', 'team-away', 'score-positive', 'score-negative']) {
        const a = luminance(colors[bg]), b = luminance(colors[fg]);
        const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        assert.ok(contrast >= 4.5, `${name} ${fg} on ${bg}: ${contrast.toFixed(2)}`);
      }
    }
  }
});
