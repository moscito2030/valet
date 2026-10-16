import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// Report filenames only, never matched secret values.
const patterns = [/gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{40,}/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /postgres(?:ql)?:\/\/[^\s:'"]+:[^\s@'"]+@/];
const names = execFileSync('git', ['ls-files', '-z'], { encoding:'utf8' }).split('\0').filter(Boolean);
const bad=[];
for (const name of names) {
  if (/^\.env(?:\.|$)/.test(name) && name !== '.env.example') { bad.push(name); continue; }
  if (/\.(?:tgz|png|jpg|woff2?|wasm)$/.test(name)) continue;
  let text; try { text=readFileSync(name,'utf8'); } catch { continue; }
  if(patterns.some(pattern=>pattern.test(text))) bad.push(name);
}
if(bad.length) { console.error('Potential secrets in tracked files: '+bad.join(', ')); process.exitCode=1; }
else console.log('Tracked-file secret patterns: no matches.');
