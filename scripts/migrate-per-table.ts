import { loadEnvConfig } from '@next/env';
import { migratePerTable } from '../lib/storage/migrate-per-table';
import { neonHttp } from '../lib/storage/sql-client';

async function main() {
  const [mode] = process.argv.slice(2);
  if (process.argv.length !== 3 || (mode !== '--dry-run' && mode !== '--apply'))
    throw new Error('請指定 --dry-run 或 --apply');
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL) throw new Error('請設定 DATABASE_URL');
  console.table(await migratePerTable(neonHttp(process.env.DATABASE_URL), mode === '--apply'));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
