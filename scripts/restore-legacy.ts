import { loadEnvConfig } from '@next/env';
import { restoreLegacy } from '../lib/storage/restore-legacy';
import { neonHttp } from '../lib/storage/sql-client';

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.VALET_RESTORE_LEGACY !== '1') {
    console.error('Refusing to restore legacy documents. Set VALET_RESTORE_LEGACY=1 to opt in.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before restoring the legacy table.');
    process.exitCode = 1;
    return;
  }
  const report = await restoreLegacy(neonHttp(process.env.DATABASE_URL), {
    dryRun: process.argv.includes('--dry-run'),
  });
  console.log(report);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.name === 'Error' ? error.message : error.name : 'Restore failed');
  process.exitCode = 1;
});
