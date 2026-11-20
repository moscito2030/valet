import { discussionTableSql } from '../lib/storage/discussions';
import { neon } from '@neondatabase/serverless';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running migrations.');
const sql = neon(process.env.DATABASE_URL);
async function main() {
  await sql`CREATE TABLE IF NOT EXISTS bridge_login_limits (key text PRIMARY KEY, attempts integer NOT NULL, window_end timestamptz NOT NULL)`;
  await sql.query(discussionTableSql);
  const { normalizedSchemaStatements } = await import('../lib/storage/schema');
  for (const statement of normalizedSchemaStatements) await sql.query(statement);
  console.log('Migration complete: normalized tables, login limits, and discussion controls are ready. Storage switch state was left unchanged.');
}
main().catch(() => {
  console.error('Migration failed. Check connection and database permissions.');
  process.exitCode = 1;
});
