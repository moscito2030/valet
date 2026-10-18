// Usage: npx tsx scripts/import-acbl-catalog.ts <extracted Pair movements directory>
// Reads movement data only. Never executes ACBLscore or its installer.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseAcblMovement } from '../lib/acbl-movement';

const directory = process.argv[2];
if (!directory) throw new Error('Provide the extracted ACBLscore 8.33 Pair movements directory');
const files = fs.readdirSync(directory).filter(name => /\.mov$/i.test(name)).sort();
if (files.length !== 75) throw new Error('Expected the 75 external pair movements in ACBLscore 8.33');
const catalog = files.map(name => {
  const bytes = fs.readFileSync(path.join(directory, name));
  return { ...parseAcblMovement(bytes, name), sha256: createHash('sha256').update(bytes).digest('hex') };
});
fs.writeFileSync(path.resolve('lib/acbl-movements.json'), JSON.stringify(catalog) + '\n');
console.log(`Validated and imported ${catalog.length} pair movements`);
