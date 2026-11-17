import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain-error';
import type { Discussion } from '../discussion';
import type { Sql } from './neon';
import { captureSql, commitSql, isConflict } from './batch';
import { storageGate } from './switch';
export const discussionTableSql =
  'CREATE TABLE IF NOT EXISTS bridge_discussions (id text PRIMARY KEY, revision integer NOT NULL, document jsonb NOT NULL)';
export type DiscussionStore = {
  read<T>(key: string, fallback: T): Promise<T>;
  update<T>(key: string, fallback: T, change: (value: T) => T): Promise<T>;
};
export function neonDiscussionStore(sql: Sql): DiscussionStore {
  async function snapshot(key: string) {
    return (await sql`SELECT revision,document FROM bridge_discussions WHERE id=${key}`)[0];
  }
  return {
    async read<T>(key: string, fallback: T) {
      return ((await snapshot(key))?.document as T) ?? fallback;
    },
    async update<T>(key: string, fallback: T, change: (v: T) => T) {
      for (let i = 0; i < 20; i++) {
        const row = await snapshot(key);
        const next = change(row ? (row.document as T) : fallback);
        const revision = Number(row?.revision ?? 0);
        const rows = revision
          ? await sql`UPDATE bridge_discussions SET document=${JSON.stringify(next)}::jsonb,revision=revision+1 WHERE id=${key} AND revision=${revision} RETURNING id`
          : await sql`INSERT INTO bridge_discussions(id,revision,document) VALUES(${key},1,${JSON.stringify(next)}::jsonb) ON CONFLICT DO NOTHING RETURNING id`;
        if (rows.length) return next;
      }
      throw new DomainError('討論區忙碌中，請稍後再試', 409);
    },
  };
}
export function localDiscussionStore(directory: string): DiscussionStore {
  let queue = Promise.resolve();
  const file = (key: string) => path.join(directory, Buffer.from(key).toString('hex') + '.json');
  async function read<T>(key: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(file(key), 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw e;
    }
  }
  return {
    read,
    async update<T>(key: string, fallback: T, change: (v: T) => T) {
      const prior = queue;
      let release!: () => void;
      queue = new Promise<void>((r) => (release = r));
      await prior;
      try {
        const next = change(await read(key, fallback));
        await mkdir(directory, { recursive: true });
        const temp = file(key) + '.' + randomUUID() + '.tmp';
        await writeFile(temp, JSON.stringify(next));
        await rename(temp, file(key));
        return next;
      } finally {
        release();
      }
    },
  };
}

function isBoardThread(key: string) {
  return key.startsWith('board:');
}

async function readThread<T>(sql: Sql, key: string, fallback: T): Promise<T> {
  const threads = await sql`SELECT revision, closed FROM bridge_discussion_threads WHERE key = ${key}`;
  if (!threads.length) return fallback;
  const comments = await sql`SELECT document FROM bridge_discussion_comments WHERE thread_key = ${key} ORDER BY ordinal`;
  return {
    ...(threads[0].closed == null ? {} : { closed: Boolean(threads[0].closed) }),
    comments: comments.map((row) => row.document),
  } as T;
}

function queueThread(sql: Sql, key: string, value: Discussion, revision: number | undefined) {
  if (revision === undefined)
    sql`INSERT INTO bridge_discussion_threads (key, revision, closed)
      VALUES (${key}, 1, ${value.closed ?? null})`;
  else {
    sql`WITH upd AS (
      UPDATE bridge_discussion_threads SET revision = ${revision + 1}, closed = ${value.closed ?? null}, updated_at = now()
      WHERE key = ${key} AND revision = ${revision}
      RETURNING 1
    ) SELECT 1 / (SELECT count(*)::int FROM upd)`;
  }
  sql`DELETE FROM bridge_discussion_comments WHERE thread_key = ${key}`;
  if (value.comments.length)
    sql`INSERT INTO bridge_discussion_comments (thread_key, comment_id, ordinal, document)
      SELECT ${key}, document->>'id', ordinal, document
      FROM jsonb_to_recordset(${JSON.stringify(value.comments.map((document, ordinal) => ({ ordinal, document })))}::jsonb)
        AS x(ordinal int, document jsonb)`;
}

export function switchingDiscussionStore(sql: Sql): DiscussionStore {
  const blob = neonDiscussionStore(sql);
  async function normalized() {
    return (await storageGate(sql)).mode === 'normalized';
  }
  return {
    async read<T>(key: string, fallback: T) {
      if (!isBoardThread(key) || !(await normalized())) return blob.read(key, fallback);
      return readThread(sql, key, fallback);
    },
    async update<T>(key: string, fallback: T, change: (value: T) => T) {
      if (!isBoardThread(key) || !(await normalized()) || !sql.transaction) return blob.update(key, fallback, change);
      for (let attempt = 0; attempt < 20; attempt++) {
        const threads = await sql`SELECT revision FROM bridge_discussion_threads WHERE key = ${key}`;
        const current = await readThread(sql, key, fallback);
        const next = change(current);
        const cap = captureSql();
        queueThread(
          cap.sql,
          key,
          next as Discussion,
          threads.length ? Number(threads[0].revision) : undefined,
        );
        try {
          await commitSql(sql, cap.batches);
          return next;
        } catch (error) {
          if (!isConflict(error)) throw error;
        }
      }
      throw new DomainError('討論區忙碌中，請稍後再試', 409);
    },
  };
}
