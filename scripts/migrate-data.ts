import { loadEnvConfig } from '@next/env';
import { formatMigrationReport, migrateLegacyDocuments } from '../lib/storage/migrate-data';
import { neonHttp } from '../lib/storage/sql-client';

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.VALET_DATA_MIGRATION !== '1') {
    console.error('Refusing to migrate data. Set VALET_DATA_MIGRATION=1 to opt in.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running the data migration.');
    process.exitCode = 1;
    return;
  }
  const dryRun = process.argv.includes('--dry-run');
  const report = await migrateLegacyDocuments(neonHttp(process.env.DATABASE_URL), { dryRun });
  console.log(formatMigrationReport(report));
  if (report.flip === 'schema-missing' || report.flip === 'already-on') process.exitCode = 1;
}

main().catch((error) => {
  const verify = error instanceof Error && error.name === 'VerifyMismatch';
  console.error(verify ? error.message : error instanceof Error ? error.name : 'Migration failed');
  process.exitCode = 1;
});
