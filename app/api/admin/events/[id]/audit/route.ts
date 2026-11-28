import { isAdmin, isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/domain-error';
import { errorResponse } from '@/lib/http';
import { getEvent, normalizedSql } from '@/lib/store';
import { readAdminAudit } from '@/lib/storage/normalized';

export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdmin())) throw new DomainError('請先登入裁判/賽務後台', 401);
    if (!(await isDirector())) throw new DomainError('僅限裁判操作', 403);
    const { id } = await params;
    const sql = normalizedSql();
    const audit = sql ? await readAdminAudit(sql, id) : [...(await getEvent(id)).event.audit].reverse();
    return Response.json(audit, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
