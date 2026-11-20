import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { exchangeCode, type AccessCode } from '@/lib/access/codes';
import { DomainError } from '@/lib/domain-error';
import { errorResponse, readJson } from '@/lib/http';
import { loadAccessCodes } from '@/lib/storage/access-records';
import { neonHttp } from '@/lib/storage/sql-client';

export const dynamic = 'force-dynamic';

async function loadCodes() {
  if (process.env.ACCESS_CODES_FILE) {
    const parsed = JSON.parse(await readFile(process.env.ACCESS_CODES_FILE, 'utf8')) as { codes?: AccessCode[] };
    return parsed.codes ?? [];
  }
  if (!process.env.DATABASE_URL) return [] as AccessCode[];
  return loadAccessCodes(neonHttp(process.env.DATABASE_URL));
}

export async function POST(request: Request) {
  try {
    const body = z.object({ secret: z.string().min(1).max(200) }).strict().parse(await readJson(request));
    const session = exchangeCode(body.secret, await loadCodes(), new Date());
    if (!process.env.SESSION_SECRET) throw new DomainError('尚未設定 SESSION_SECRET', 503);
    const response = NextResponse.json(
      { ok: true, scope: session.scope, role: session.role },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    const mac = createHmac('sha256', process.env.SESSION_SECRET).update(session.codeId).digest('hex');
    response.cookies.set('valet_access', `${session.codeId}.${mac}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 28800,
    });
    return response;
  } catch (error) {
    if (error instanceof DomainError) return errorResponse(error);
    return errorResponse(error);
  }
}
