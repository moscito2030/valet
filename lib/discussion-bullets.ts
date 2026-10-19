import type { Comment } from './discussion';
export type BulletComment = Pick<Comment, 'id' | 'nickname' | 'text' | 'hidden' | 'deleted'>;
/** Each cycle includes every visible comment once, without mutating the source. */
export function shuffledBullets(
  comments: BulletComment[],
  previous?: string,
  random = Math.random,
) {
  const result = comments.filter((c) => !c.hidden && !c.deleted);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  if (result.length > 1 && result[0].id === previous) {
    [result[0], result[1]] = [result[1], result[0]];
  }
  return result;
}
export function freeBulletLane(occupied: number[], random = Math.random) {
  const free = [0, 1, 2, 3].filter((lane) => !occupied.includes(lane));
  return free.length ? free[Math.floor(random() * free.length)] : undefined;
}
