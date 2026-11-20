import { loadEnvConfig } from '@next/env';
import { formatPublicationReport, materializePublication } from '../lib/storage/materialize-publication';
import { neonHttp } from '../lib/storage/sql-client';

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.VALET_MATERIALIZE_PUBLICATION !== '1') {
    console.error('Refusing to materialize publication. Set VALET_MATERIALIZE_PUBLICATION=1 to opt in.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running the publication migration.');
    process.exitCode = 1;
    return;
  }
  const report = await materializePublication(neonHttp(process.env.DATABASE_URL), {
    dryRun: process.argv.includes('--dry-run'),
  });
  console.log(formatPublicationReport(report));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
