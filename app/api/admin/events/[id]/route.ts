import { NextResponse } from 'next/server';
import { isAdmin, isDirector } from '@/lib/auth';
import { adminResponse, readAdmin } from '@/lib/storage/normalized';
import { deleteEvent, normalizedSql } from '@/lib/store';
import { getAccessibleEvent as getEvent } from '@/lib/event-access';
import { DomainError } from '@/lib/domain-error';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdmin())) throw new DomainError('請先登入', 401);
    const { id } = await params;
    const director = await isDirector();
    const sql = normalizedSql();
    const validator = request.headers.get('if-none-match');
    if (sql) return await readAdmin(sql, id, validator, director);
    return adminResponse(await getEvent(id), director, validator);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    if (!(await isDirector())) throw new DomainError('此操作僅限裁判', 403);
    const id = (await params).id;
    const body = await readJson(request);
    const stored = await getEvent(id);
    if (body?.confirmStageName !== undefined
      ? body.confirmStageName !== (stored.event.stageName ?? stored.event.name)
      : body?.confirmName !== stored.event.name)
      throw new DomainError('請輸入完整賽事名稱以確認刪除');
    if (body?.revision !== stored.event.revision)
      throw new DomainError('賽事已更新，請重新載入後再刪除', 409);
    await deleteEvent(id, body.revision);
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return errorResponse(e);
  }
}
