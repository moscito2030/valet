import { neon } from '@neondatabase/serverless';
import type { SqlBatch } from './batch';
import type { Sql } from './neon';

// HTTPS only. `neon()` does not open port 5432. Transactions are arrays of
// statements; nothing is read until the whole batch finishes.
export function neonHttp(connectionString: string): Sql {
  const http = neon(connectionString);
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) =>
    (await http(strings, ...values)) as Record<string, unknown>[]) as Sql;
  sql.transaction = async (queries: SqlBatch[]) =>
    (await http.transaction(queries.map((query) => http.query(query.text, query.values)))) as Record<
      string,
      unknown
    >[][];
  sql.query = async (text: string) => {
    await http.query(text);
  };
  return sql;
}
