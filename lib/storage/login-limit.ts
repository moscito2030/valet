import { createHmac } from 'node:crypto';
import { DomainError } from '../domain-error';
import type { Sql } from './neon';

export function loginClientKey(request: Request, sessionSecret: string) {
  const ip = (
    request.headers.get('x-vercel-forwarded-for') ??
    request.headers.get('x-forwarded-for') ??
    'local'
  ).split(',')[0].trim();
  return createHmac('sha256', sessionSecret).update(ip).digest('hex');
}

export class LoginRateLimitError extends DomainError {
  constructor(public retryAfter: number) {
    super('登入嘗試次數過多，請稍後再試。', 429, 'RATE_LIMITED');
  }
}

function checkWindow(row?: Record<string, unknown>) {
  if (row && Number(row.attempts) > 10)
    throw new LoginRateLimitError(Number(row.retry_after));
}

export async function checkPersistentLoginLimit(sql: Sql, key: string) {
  const [row] = await sql`SELECT attempts, ceil(extract(epoch FROM window_end - now())) AS retry_after
    FROM bridge_login_limits WHERE key = ${key} AND window_end > now()`;
  checkWindow(row);
}

export async function recordPersistentLoginFailure(sql: Sql, key: string) {
  await sql`DELETE FROM bridge_login_limits WHERE window_end <= now()`;
  const [row] = await sql`INSERT INTO bridge_login_limits (key, attempts, window_end)
    VALUES (${key}, 1, now() + interval '10 minutes')
    ON CONFLICT (key) DO UPDATE SET
      attempts = CASE WHEN bridge_login_limits.window_end <= now() THEN 1 ELSE bridge_login_limits.attempts + 1 END,
      window_end = CASE WHEN bridge_login_limits.window_end <= now() THEN EXCLUDED.window_end ELSE bridge_login_limits.window_end END
    RETURNING attempts, ceil(extract(epoch FROM window_end - now())) AS retry_after`;
  checkWindow(row);
}
