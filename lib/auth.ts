import { createSession, verifySession } from './session-token';
import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
export function authConfigured() {
  return (
    (process.env.ADMIN_PASSWORD?.length ?? 0) >= 16 &&
    (process.env.SESSION_SECRET?.length ?? 0) >= 32
  );
}
function safeEqual(a: string, b: string) {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}
export function passwordMatches(password: string) {
  return authConfigured() && safeEqual(password, process.env.ADMIN_PASSWORD!);
}
export function loginRole(password: string): 'admin' | 'director' | null {
  const director = process.env.DIRECTOR_PASSWORD;
  if (
    authConfigured() &&
    director &&
    director.length >= 16 &&
    director !== process.env.ADMIN_PASSWORD &&
    safeEqual(password, director)
  )
    return 'director';
  return passwordMatches(password) ? 'admin' : null;
}
function sessionConfig() {
  return { secret: process.env.SESSION_SECRET!, adminPassword: process.env.ADMIN_PASSWORD!, directorPassword: process.env.DIRECTOR_PASSWORD };
}
export function issueSession(role: 'admin' | 'director' = 'admin') {
  if (!authConfigured()) throw new Error('Authentication is not configured');
  return createSession(role, sessionConfig());
}
async function sessionRole() {
  if (!authConfigured()) return null;
  const token = (await cookies()).get('bridge_admin')?.value;
  return token ? verifySession(token, sessionConfig()) : null;
}
export async function isAdmin() {
  return (await sessionRole()) !== null;
}
export async function isDirector() {
  return (await sessionRole()) === 'director';
}
