import { dealHcp } from './recorded-hcp';
import { DomainError } from './domain-error';
import { z } from 'zod';
import type { BridgeEvent } from './model';

export type Comment = {
  id: string;
  author: string;
  nickname: string;
  text: string;
  createdAt: string;
  hidden?: boolean;
  deleted?: boolean;
  replyTo?: string;
};
export type Discussion = { closed?: boolean; comments: Comment[] };
export const commentSchema = z
  .object({
    nickname: z.string().trim().min(1, '請填暱稱').max(30),
    text: z.string().trim().min(1, '請填留言').max(1000, '留言最多 1000 字'),
    replyTo: z.string().uuid().optional(),
  })
  .strict();
export const moderationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hide'), id: z.string().uuid(), hidden: z.boolean() }).strict(),
  z.object({ action: z.literal('delete'), id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('block'), id: z.string().uuid(), blocked: z.boolean() }).strict(),
  z.object({ action: z.literal('close'), closed: z.boolean() }).strict(),
  z.object({ action: z.literal('global'), closed: z.boolean() }).strict(),
]);
export function discussionPublished(e: BridgeEvent, number: number) {
  const b = e.boards.find((b) => b.number === number);
  return (
    !!b &&
    !!(b.published ?? e.publishBoards) &&
    !!dealHcp(b.deal) &&
    !e.stageArchived &&
    !e.competition?.archived &&
    (!e.club?.enabled ||
      e.assignments
        .filter((a) => a.boards.includes(number))
        .every((a) => e.club!.finalized.includes(a.round)))
  );
}
export function addComment(d: Discussion, c: Comment) {
  if (d.closed) throw new DomainError('本副討論已關閉', 403);
  if (d.comments.length >= 500) throw new DomainError('本副留言已達上限', 403);
  if (c.replyTo && !d.comments.some((r) => r.id === c.replyTo && !r.hidden && !r.deleted))
    throw new DomainError('回覆的留言已不存在');
  if (d.comments.some((r) => !r.deleted && r.author === c.author && r.text === c.text))
    throw new DomainError('請勿重複發送相同留言', 429);
  return { ...d, comments: [...d.comments, c] };
}
export function commentView(d: Discussion, author: string, director: boolean) {
  return {
    ...d,
    comments: d.comments
      .filter((c) => !c.deleted && (!c.hidden || director))
      .map(({ author: owner, ...c }) => ({ ...c, own: owner === author })),
  };
}
export type LimitState = { minute: number; minuteCount: number; day: number; dayCount: number };
export function consumeLimit(
  s: Partial<LimitState>,
  now: number,
  shortMax: number,
  dailyMax: number,
): LimitState {
  const minute = Math.floor(now / 600000),
    day = Math.floor(now / 86400000);
  const minuteCount = s.minute === minute ? (s.minuteCount ?? 0) + 1 : 1,
    dayCount = s.day === day ? (s.dayCount ?? 0) + 1 : 1;
  if (minuteCount > shortMax || dayCount > dailyMax)
    throw new DomainError('留言過於頻繁，請稍後再試（每日額度於 UTC 午夜重設）', 429);
  return { minute, minuteCount, day, dayCount };
}
export function moderateComment(
  d: Discussion,
  command: Extract<z.infer<typeof moderationSchema>, { action: 'hide' | 'delete' | 'close' }>,
  author: string,
  director: boolean,
): Discussion {
  if (command.action !== 'delete' && !director) throw new DomainError('此操作需要裁判權限', 403);
  if (command.action === 'close') return { ...d, closed: command.closed };
  const target = d.comments.find((c) => c.id === command.id);
  if (!target) throw new DomainError('找不到留言', 404);
  if (!director && target.author !== author) throw new DomainError('只能刪除自己的留言', 403);
  return {
    ...d,
    comments: d.comments.map((c) =>
      c.id !== command.id
        ? c
        : command.action === 'hide'
          ? { ...c, hidden: command.hidden }
          : { ...c, deleted: true, text: '', nickname: '' },
    ),
  };
}
