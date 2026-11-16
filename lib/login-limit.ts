import 'server-only';
import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { DomainError } from './domain-error';
import { nextLoginFailure, type LoginWindow } from './login-limit-policy';

const localAttempts = new Map<string, LoginWindow>();

function clientKey(request: Request) {
  const ip = (
    request.headers.get('x-vercel-forwarded-for') ??
    request.headers.get('x-forwarded-for') ??
    'local'
  )
    .split(',')[0]
    .trim();
  return createHmac('sha256', process.env.SESSION_SECRET!).update(ip).digest('hex');
}

function persistent() {
  return process.env.STORAGE_MODE === 'neon' || !!process.env.DATABASE_URL;
}

export async function recordLoginFailure(request: Request) {
  const key = clientKey(request);
  if (persistent()) {
    if (!process.env.DATABASE_URL) throw new DomainError('尚未設定資料庫', 503);
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM bridge_login_limits WHERE window_end < now()`;
    const rows =
      await sql`INSERT INTO bridge_login_limits (key,attempts,window_end) VALUES (${key},1,now()+interval '10 minutes') ON CONFLICT (key) DO UPDATE SET attempts=CASE WHEN bridge_login_limits.window_end<now() THEN 1 ELSE bridge_login_limits.attempts+1 END, window_end=CASE WHEN bridge_login_limits.window_end<now() THEN now()+interval '10 minutes' ELSE bridge_login_limits.window_end END RETURNING attempts`;
    if (Number(rows[0].attempts) > 10)
      throw new DomainError('登入嘗試次數過多，請於十分鐘後再試。', 429);
    return;
  }
  const now = Date.now();
  for (const [storedKey, window] of localAttempts) if (window.until < now) localAttempts.delete(storedKey);
  const next = nextLoginFailure(localAttempts.get(key), now);
  localAttempts.set(key, next);
  if (next.blocked) throw new DomainError('登入嘗試次數過多，請於十分鐘後再試。', 429);
}

export async function clearLoginFailures(request: Request) {
  const key = clientKey(request);
  if (persistent()) {
    if (!process.env.DATABASE_URL) return;
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM bridge_login_limits WHERE key=${key}`;
    return;
  }
  localAttempts.delete(key);
}
