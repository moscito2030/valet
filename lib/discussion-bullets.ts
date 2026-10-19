import type { Comment } from './discussion';
export type BulletComment = Pick<Comment, 'id' | 'nickname' | 'text' | 'hidden' | 'deleted'>;
/** Only a small recent backlog is played on activation; refreshes never replay IDs. */
export function nextBullets(comments: BulletComment[], seen: Set<string>, initial: boolean) {
  const eligible = comments.filter((c) => !c.hidden && !c.deleted);
  const fresh = initial ? eligible.slice(-8) : eligible.filter((c) => !seen.has(c.id));
  return { fresh: fresh.slice(-30), seen: new Set(comments.map((c) => c.id)) };
}
