import type { Comment } from './discussion';
export type BulletComment = Pick<Comment, 'id' | 'nickname' | 'text' | 'hidden' | 'deleted'>;
export const bulletFonts = [
  '"IBM Plex Sans", Arial, "Noto Sans TC", sans-serif',
  '"Source Serif 4", Georgia, "Noto Serif TC", serif',
  '"Kalam", "LXGW WenKai TC", "Noto Sans TC", sans-serif',
  '"Caveat", "Iansui", "Noto Serif TC", serif',
  '"Patrick Hand", "Huninn", "Noto Sans TC", sans-serif',
] as const;
export const bulletFontStylesheet =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@500&family=Source+Serif+4:wght@500&family=Kalam&family=Caveat:wght@500&family=Patrick+Hand&family=Noto+Sans+TC:wght@500&family=Noto+Serif+TC:wght@500&family=LXGW+WenKai+TC&family=Iansui&family=Huninn&display=swap';
export function randomBulletFont(random = Math.random) {
  return bulletFonts[Math.floor(random() * bulletFonts.length)];
}
/** Preserve mobile timing; give wider boards proportionally more travel time. */
export function bulletDuration(width: number) {
  return Math.max(7500, (width / 600) * 7500);
}
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
  const free = [0, 1, 2, 3, 4, 5].filter((lane) => !occupied.includes(lane));
  return free.length ? free[Math.floor(random() * free.length)] : undefined;
}
