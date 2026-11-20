import 'server-only';
import { DomainError } from './domain-error';
import { loginFailureLimit, nextLoginFailure, type LoginWindow } from './login-limit-policy';
import { neonHttp } from './storage/sql-client';
import { checkPersistentLoginLimit, LoginRateLimitError, loginClientKey, recordPersistentLoginFailure } from './storage/login-limit';

const localAttempts = new Map<string, LoginWindow>();

function persistent() {
  return process.env.STORAGE_MODE === 'neon' || !!process.env.DATABASE_URL;
}

export async function checkLoginLimit(request: Request) {
  const key = loginClientKey(request, process.env.SESSION_SECRET!);
  if (persistent()) {
    if (!process.env.DATABASE_URL) throw new DomainError('尚未設定資料庫', 503);
    return checkPersistentLoginLimit(neonHttp(process.env.DATABASE_URL), key);
  }
  const window = localAttempts.get(key);
  const now = Date.now();
  if (window && window.until > now && window.count > loginFailureLimit)
    throw new LoginRateLimitError(Math.ceil((window.until - now) / 1000));
}

export async function recordLoginFailure(request: Request) {
  const key = loginClientKey(request, process.env.SESSION_SECRET!);
  if (persistent()) {
    if (!process.env.DATABASE_URL) throw new DomainError('尚未設定資料庫', 503);
    return recordPersistentLoginFailure(neonHttp(process.env.DATABASE_URL), key);
  }
  const now = Date.now();
  for (const [storedKey, window] of localAttempts) if (window.until < now) localAttempts.delete(storedKey);
  const next = nextLoginFailure(localAttempts.get(key), now);
  localAttempts.set(key, next);
  if (next.blocked) throw new LoginRateLimitError(Math.ceil((next.until - now) / 1000));
}

export async function clearLoginFailures(request: Request) {
  const key = loginClientKey(request, process.env.SESSION_SECRET!);
  if (persistent()) {
    if (!process.env.DATABASE_URL) return;
    const sql = neonHttp(process.env.DATABASE_URL);
    await sql`DELETE FROM bridge_login_limits WHERE key=${key}`;
    return;
  }
  localAttempts.delete(key);
}
