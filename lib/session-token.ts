import { createHmac, timingSafeEqual } from 'node:crypto';
export type SessionRole = 'admin' | 'director';
export type SessionConfig = { secret: string; adminPassword: string; directorPassword?: string };
function signature(payload: string, role: SessionRole, config: SessionConfig) {
  const password = role === 'director' ? config.directorPassword : config.adminPassword;
  return createHmac('sha256', config.secret)
    .update(JSON.stringify([payload, password]))
    .digest('hex');
}
export function createSession(role: SessionRole, config: SessionConfig, now = Date.now()) {
  const payload = role + ':' + (now + 8 * 60 * 60 * 1000);
  return payload + ':' + signature(payload, role, config);
}
export function verifySession(
  token: string,
  config: SessionConfig,
  now = Date.now(),
): SessionRole | null {
  const parts = token.split(':');
  if (parts.length !== 3) return null;
  const [role, expiry, mac] = parts;
  if (role !== 'admin' && role !== 'director') return null;
  if (
    role === 'director' &&
    (!config.directorPassword ||
      config.directorPassword.length < 16 ||
      config.directorPassword === config.adminPassword)
  )
    return null;
  if (
    !/^\d+$/.test(expiry) ||
    !Number.isSafeInteger(Number(expiry)) ||
    Number(expiry) <= now ||
    Number(expiry) > now + 8 * 60 * 60 * 1000 ||
    !/^[a-f0-9]{64}$/.test(mac)
  )
    return null;
  return timingSafeEqual(
    Buffer.from(mac, 'hex'),
    Buffer.from(signature(role + ':' + expiry, role, config), 'hex'),
  )
    ? role
    : null;
}
