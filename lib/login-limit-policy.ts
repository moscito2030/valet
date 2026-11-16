export type LoginWindow = { count: number; until: number };

const windowMs = 600_000;

export function nextLoginFailure(previous: LoginWindow | undefined, now: number) {
  const fresh = !previous || previous.until <= now;
  const count = fresh ? 1 : previous.count + 1;
  const until = fresh ? now + windowMs : previous.until;
  return { count, until, blocked: count > 10 };
}
