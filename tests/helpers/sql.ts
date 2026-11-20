import { PGlite } from '@electric-sql/pglite';
import type { SqlBatch } from '../../lib/storage/batch';
import { discussionTableSql } from '../../lib/storage/discussions';
import type { Sql } from '../../lib/storage/neon';
import { normalizedSchemaStatements } from '../../lib/storage/schema';

export async function createTestDb() {
  const db = new PGlite();
  await db.exec(
    'CREATE TABLE bridge_events (id text PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0), document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())',
  );
  await db.exec(discussionTableSql);
  for (const statement of normalizedSchemaStatements) await db.exec(statement);
  await db.exec("INSERT INTO bridge_storage_switch (id, mode) VALUES (1, 'normalized')");
  const direct: Sql = async (strings, ...values) =>
    (
      await db.query(
        strings.reduce((query, part, index) => query + (index ? `$${index}` : '') + part, ''),
        values,
      )
    ).rows as Record<string, unknown>[];
  let chain = Promise.resolve();
  const sql = (async (strings, ...values) => {
    const run = chain.then(() => direct(strings, ...values));
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }) as Sql;
  // Same contract as neon().transaction([...]): statements are fixed, then one transaction runs them.
  sql.transaction = (queries: SqlBatch[]) => {
    const run = chain.then(async () => {
      await db.exec('BEGIN');
      try {
        const results = [];
        for (const query of queries) results.push((await db.query(query.text, query.values)).rows);
        await db.exec('COMMIT');
        return results as Record<string, unknown>[][];
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return { db, sql, close: () => db.close() };
}

