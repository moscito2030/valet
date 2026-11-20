export type LoginWindow = { count: number; until: number };

export const loginWindowSeconds = 600;
export const loginFailureLimit = 10;

export function nextLoginFailure(previous: LoginWindow | undefined, now: number) {
  const fresh = !previous || previous.until <= now;
  const count = fresh ? 1 : previous.count + 1;
  const until = fresh ? now + loginWindowSeconds * 1000 : previous.until;
  return { count, until, blocked: count > loginFailureLimit };
}
