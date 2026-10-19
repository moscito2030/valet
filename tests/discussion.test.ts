import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  addComment,
  commentSchema,
  commentView,
  consumeLimit,
  discussionPublished,
  moderateComment,
  type Discussion,
  type Comment,
} from '../lib/discussion';
import {
  discussionTableSql,
  localDiscussionStore,
  neonDiscussionStore,
} from '../lib/storage/discussions';
import type { Sql } from '../lib/storage/neon';
import { createEvent } from '../lib/events';
import { audienceEvent } from '../lib/read-models/public-event';
const comment = (text = 'hello', author = 'a'): Comment => ({
  id: randomUUID(),
  author,
  nickname: 'Player',
  text,
  createdAt: new Date().toISOString(),
});
test('discussion opens only with real public deals and all scheduled uses settled', () => {
  const e = createEvent({
    name: 'Discussion',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-10-20',
    venue: '',
    rounds: 2,
    boardsPerRound: 1,
  });
  const cards = ['C', 'D', 'H', 'S'].flatMap((s) => [...'23456789TJQKA'].map((r) => s + r));
  e.boards[0].deal = {
    N: cards.slice(0, 13),
    E: cards.slice(13, 26),
    S: cards.slice(26, 39),
    W: cards.slice(39),
  };
  e.publishBoards = false;
  e.boards[0].published = false;
  assert.equal(discussionPublished(e, 1), false);
  e.boards[0].published = true;
  assert.equal(discussionPublished(e, 1), true);
  e.club = { enabled: true, tokens: {}, confirmations: {}, finalized: [] };
  assert.equal(discussionPublished(e, 1), false);
  e.club.finalized = [1];
  assert.equal(discussionPublished(e, 1), true);
  e.assignments.find((a) => a.round === 2)!.boards.push(1);
  assert.equal(discussionPublished(e, 1), false);
  assert.equal(audienceEvent(e).boards[0].published, false);
  e.club.finalized.push(2);
  assert.equal(discussionPublished(e, 1), true);
  e.stageArchived = true;
  assert.equal(discussionPublished(e, 1), false);
  assert.equal(discussionPublished(e, 999), false);
});
test('moderation permissions, ownership and hidden contents never leak to public', () => {
  const c = comment();
  const d = { comments: [c] };
  assert.throws(() => moderateComment(d, { action: 'delete', id: c.id }, 'other', false));
  assert.throws(() => moderateComment(d, { action: 'hide', id: c.id, hidden: true }, 'a', false));
  assert.throws(() => moderateComment(d, { action: 'close', closed: true }, 'a', false));
  const hidden = moderateComment(d, { action: 'hide', id: c.id, hidden: true }, 'director', true);
  assert.deepEqual(commentView(hidden, 'a', false).comments, []);
  assert.equal(commentView(hidden, 'director', true).comments.length, 1);
  assert.equal('author' in commentView(d, 'a', false).comments[0], false);
  assert.equal(commentView(d, 'a', false).comments[0].own, true);
  const deleted = moderateComment(d, { action: 'delete', id: c.id }, 'a', false);
  assert.equal(deleted.comments[0].text, '');
  assert.equal(commentView(deleted, 'a', true).comments.length, 0);
  assert.equal(d.comments[0].text, 'hello');
});
test('closed threads, duplicate posts, invalid replies and bounded content are rejected', () => {
  const c = comment();
  const d = { comments: [c] };
  assert.throws(() => addComment({ ...d, closed: true }, comment('new')));
  assert.throws(() => addComment(d, comment()));
  assert.throws(() => addComment(d, { ...comment('reply'), replyTo: randomUUID() }));
  assert.equal(addComment(d, { ...comment('reply'), replyTo: c.id }).comments.length, 2);
  assert.throws(() => addComment({ comments: Array(500).fill(c) }, comment('new')));
  assert.equal(commentSchema.safeParse({ nickname: 'x', text: ' '.repeat(5) }).success, false);
  assert.equal(commentSchema.safeParse({ nickname: 'x', text: 'x'.repeat(1001) }).success, false);
  assert.equal(
    commentSchema.safeParse({ nickname: 'x', text: 'hello', author: 'spoof' }).success,
    false,
  );
});
test('rate limits enforce both windows and reset without forgetting daily usage', () => {
  let s = consumeLimit({}, 0, 2, 3);
  s = consumeLimit(s, 1, 2, 3);
  assert.throws(() => consumeLimit(s, 2, 2, 3));
  s = consumeLimit(s, 600000, 2, 3);
  assert.equal(s.dayCount, 3);
  assert.throws(() => consumeLimit(s, 1200000, 2, 3));
  assert.equal(consumeLimit(s, 86400000, 2, 3).dayCount, 1);
});
for (const kind of ['local', 'postgres'])
  test(`${kind} discussion writes preserve concurrent posts and persist independently`, async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'valet-discussion-'));
    const db = kind === 'postgres' ? new PGlite() : undefined;
    try {
      if (db) await db.exec(discussionTableSql);
      const sql: Sql = async (strings, ...values) =>
        (
          await db!.query(
            strings.reduce((s, p, i) => s + (i ? `$${i}` : '') + p, ''),
            values,
          )
        ).rows as Record<string, unknown>[];
      const store = db ? neonDiscussionStore(sql) : localDiscussionStore(directory);
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          store.update<Discussion>('board:a:1', { comments: [] }, (d) =>
            addComment(d, comment(String(i))),
          ),
        ),
      );
      const read = db ? neonDiscussionStore(sql) : localDiscussionStore(directory);
      assert.equal((await read.read<Discussion>('board:a:1', { comments: [] })).comments.length, 8);
      assert.equal((await read.read<Discussion>('board:b:1', { comments: [] })).comments.length, 0);
      await store.update<Discussion>('board:a:1', { comments: [] }, (d) => ({
        ...d,
        closed: true,
      }));
      await assert.rejects(() =>
        store.update<Discussion>('board:a:1', { comments: [] }, (d) =>
          addComment(d, comment('closed')),
        ),
      );
      const limits = await Promise.allSettled(
        Array.from({ length: 8 }, () => store.update('limit', {}, (s) => consumeLimit(s, 0, 3, 3))),
      );
      assert.equal(limits.filter((r) => r.status === 'fulfilled').length, 3);
    } finally {
      await db?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
