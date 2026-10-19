import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain-error';
import type { Sql } from './neon';
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
