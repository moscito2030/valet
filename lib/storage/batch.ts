import type { Sql } from './neon';

// One statement the HTTP driver can send. `sql.transaction` runs the list as one
// Postgres transaction and does not read between statements.
export type SqlBatch = { text: string; values: unknown[] };

export function captureSql(): { sql: Sql; batches: SqlBatch[] } {
  const batches: SqlBatch[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    batches.push({
      text: strings.reduce((query, part, index) => query + (index ? `$${index}` : '') + part, ''),
      values,
    });
    return Promise.resolve([] as Record<string, unknown>[]);
  }) as Sql;
  return { sql, batches };
}

export async function commitSql(sql: Sql, batches: SqlBatch[]) {
  if (!batches.length) return [];
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。連線請用 HTTPS，不要用 Postgres 連線埠。');
  return sql.transaction(batches);
}

// Sequence allocation must follow commit order within a stage, or a later commit
// can change scores without advancing the maximum seen by a scoreboard reader.
export function queueDataVersion(sql: Sql, id: string) {
  sql`SELECT set_config('valet.data_version', nextval('bridge_data_version')::text, true) AS version
    FROM pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
}

export function isConflict(error: unknown) {
  const code = (error as { code?: string }).code;
  if (code === '22012' || code === '23505' || code === '40001' || code === '40P01') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /division by zero|duplicate key|could not serialize|deadlock/i.test(message);
}
