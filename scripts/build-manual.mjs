import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Official release archives, pinned by version and SHA-256. No Rust toolchain required.
const version = '0.5.4';
const targets = {
  'win32-x64': ['x86_64-pc-windows-msvc.zip', '8a6b2421aa522de06d746871d2b8fff9c8d71773467e310a4516d2566e7f2de4'],
  'linux-x64': ['x86_64-unknown-linux-musl.tar.gz', '5222beabd3e37dc5be0d18ff99b79058469354db5c220153a1b92db5ba12be89'],
  'linux-arm64': ['aarch64-unknown-linux-musl.tar.gz', '753e5c5c363ee8a56972344dcf91466f005a51db84a7aeffe427ae3ef83d6d44'],
  'darwin-arm64': ['aarch64-apple-darwin.tar.gz', '03e8a6d8b13a2971e0b3280affd03b388373c1485e26f73407c3a76b0b1838df'],
  'darwin-x64': ['x86_64-apple-darwin.tar.gz', 'a47d7bf0d5d670cff9ee6cce95537cbeb62dc10704d9e7131ffbd13e2b59a5de'],
};
const target = targets[`${process.platform}-${process.arch}`];
if (!target) throw new Error(`Unsupported mdBook platform: ${process.platform}/${process.arch}`);
const cache = path.resolve('.tmp', `mdbook-${version}-${process.platform}-${process.arch}`);
await mkdir(cache, { recursive: true });
const archive = path.join(cache, `mdbook-${version}-${target[0]}`);
let bytes;
try { bytes = await readFile(archive); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!bytes) {
  const response = await fetch(`https://github.com/rust-lang/mdBook/releases/download/v${version}/mdbook-v${version}-${target[0]}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`mdBook download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== target[1]) throw new Error('mdBook archive checksum mismatch');
await writeFile(archive, bytes);
function run(file, args) {
  const result = spawnSync(file, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} failed (${result.status})`);
}
run('tar', ['-xf', archive, '-C', cache]);
run(path.join(cache, process.platform === 'win32' ? 'mdbook.exe' : 'mdbook'), ['build', 'manual']);

// Keep the standard mdBook template while making the book title a native home link.
const output = path.resolve('public/manual');
for (const file of await readdir(output)) {
  if (!file.endsWith('.html')) continue;
  const location = path.join(output, file);
  const html = await readFile(location, 'utf8');
  if (!html.includes('<h1 class="menu-title">')) continue;
  await writeFile(location, html
    .replace('</head>', '<link rel="stylesheet" href="/theme-colors.css"><link rel="stylesheet" href="/manual-theme.css"><script src="/theme.js"></script></head>')
    .replace('</body>', '<valet-theme-picker></valet-theme-picker></body>')
    .replace('<body', '<body id="manual-top"')
    .replace(/<h1 class="menu-title">([^<]+)<\/h1>/, '<h1 class="menu-title"><a href="index.html#manual-top" aria-label="回到手冊首頁最上方">$1</a></h1>'));
}
