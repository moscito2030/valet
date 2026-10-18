import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [name, entry] of Object.entries(lock.packages)) {
  assert.ok(!entry.link, `Deployment cannot use a local symlink: ${name}`);
  for (const value of [entry.resolved, ...Object.values(entry.dependencies ?? {})]) {
    if (value?.startsWith('file:')) assert.match(value, /^file:vendor\/[^/]+\.tgz$/, `Non-portable local dependency in ${name}: ${value}`);
  }
}
const viewer = lock.packages['node_modules/@valet/deal-viewer'];
assert.equal(viewer.resolved, manifest.dependencies['@valet/deal-viewer']);
assert.ok(!viewer.dependencies?.valet, 'The shared viewer must not depend on its consuming app');
console.log('Deployment dependency paths verified.');
