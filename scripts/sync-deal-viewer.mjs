import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const target = resolve(process.argv[2] || '../valet-review');
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run via npm run viewer:sync -- <review directory>');
const run = (args, cwd) => {
  const result = spawnSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};
await mkdir(resolve(target, 'vendor'), { recursive: true });
const packed = JSON.parse(run(['pack', './packages/deal-viewer', '--json', '--pack-destination', resolve(target, 'vendor')], process.cwd()))[0];
run(['install', './vendor/' + packed.filename, '--offline', '--ignore-scripts'], target);
console.log('Updated shared viewer:', packed.filename);
