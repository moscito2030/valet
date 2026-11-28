import { isAdmin, isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/domain-error';
import { errorResponse } from '@/lib/http';
import { getEvent, normalizedSql } from '@/lib/store';
import { localClubStatus, readClubStatus } from '@/lib/storage/club-status';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await isAdmin())) throw new DomainError('請先登入裁判/賽務後台', 401);
    if (!(await isDirector())) throw new DomainError('僅限裁判操作', 403);
    const { id } = await params;
    const validator = request.headers.get('if-none-match');
    const sql = normalizedSql();
    if (sql) return await readClubStatus(sql, id, validator);
    const { event } = await getEvent(id);
    const headers = { ETag: `"${event.revision}"`, 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
    if (headers.ETag === validator) return new Response(null, { status: 304, headers });
    return Response.json(localClubStatus(event), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
