import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve('public');
const book = path.join(root, 'manual');
const files = await readdir(book, { recursive: true });
const htmlFiles = files.filter(file => file.endsWith('.html'));
if (!htmlFiles.includes('index.html')) throw new Error('Build the manual first');
const errors = [];
for (const file of htmlFiles) {
  const html = await readFile(path.join(book, file), 'utf8');
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = match[1].replaceAll('&amp;', '&');
    if (/^(?:[a-z]+:|\/\/)/i.test(url) || url === '/') continue;
    const [pathname, fragment] = url.split('#');
    const clean = decodeURIComponent(pathname.split('?')[0]);
    let target = clean.startsWith('/') ? path.join(root, clean) : path.resolve(book, path.dirname(file), clean || path.basename(file));
    if (clean.endsWith('/')) target = path.join(target, 'index.html');
    try {
      if (!(await stat(target)).isFile()) throw new Error('Not a file');
      if (fragment && target.endsWith('.html')) {
        const content = await readFile(target, 'utf8');
        if (!content.includes(`id="${decodeURIComponent(fragment)}"`)) throw new Error('Missing anchor');
      }
    } catch { errors.push(`${file}: ${url}`); }
  }
}
if (errors.length) throw new Error(`Broken manual links:\n${[...new Set(errors)].join('\n')}`);
// Exercise the shipped search integration against the real generated index.
const context = vm.createContext({ window: { search: {} }, console });
for (const pattern of [/^elasticlunr-.*\.js$/, /^searchindex-.*\.js$/]) {
  const file = files.find(name => pattern.test(name));
  assert.ok(file, `Missing search asset ${pattern}`);
  vm.runInContext(await readFile(path.join(book, file), 'utf8'), context);
}
vm.runInContext(await readFile('manual/theme/search-zh.js', 'utf8'), context);
vm.runInContext('var index = elasticlunr.Index.load(window.search.index)', context);
const results = vm.runInContext('index.search("圈數")', context);
assert.ok(results.some(result => result.doc.title.includes('圈數')));
assert.ok(results.every(result => result.doc.body !== undefined && context.window.search.doc_urls[result.ref]));
assert.ok(vm.runInContext('index.search("Mitchell").length > 0', context));
assert.equal(vm.runInContext('index.search("不存在的搜尋詞").length', context), 0);
console.log(`Manual verified: ${htmlFiles.length} HTML pages and their local links/assets.`);
