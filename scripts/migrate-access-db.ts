import { loadEnvConfig } from '@next/env';
import { assignAccessRecords, formatAccessAssignment } from '../lib/storage/access-records';
import { neonHttp } from '../lib/storage/sql-client';

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.VALET_ACCESS_CODES !== '1') {
    console.error('Refusing to assign access codes. Set VALET_ACCESS_CODES=1 to opt in.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL before running the access-code migration.');
    process.exitCode = 1;
    return;
  }
  const siteAdminSecret = process.env.SITE_ADMIN_PASSWORD;
  const directorSecret = process.env.DIRECTOR_PASSWORD;
  if (!siteAdminSecret || !directorSecret) throw new Error('SITE_ADMIN_PASSWORD and DIRECTOR_PASSWORD are required');
  if (siteAdminSecret === process.env.ADMIN_PASSWORD)
    throw new Error('SITE_ADMIN_PASSWORD must be a new credential, not ADMIN_PASSWORD');
  const report = await assignAccessRecords(neonHttp(process.env.DATABASE_URL), {
    siteAdminSecret,
    directorSecret,
    now: new Date().toISOString(),
    dryRun: process.argv.includes('--dry-run'),
  });
  console.log(formatAccessAssignment(report));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
