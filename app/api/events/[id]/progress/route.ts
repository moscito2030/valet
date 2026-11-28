import { isDirector } from '@/lib/auth';
import { getAccessibleEvent } from '@/lib/event-access';
import { errorResponse } from '@/lib/http';
import { eventProgress } from '@/lib/round-progress';
import { readProgress } from '@/lib/storage/progress';
import { normalizedSql } from '@/lib/store';

export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const validator = request.headers.get('if-none-match');
    const sql = normalizedSql();
    if (sql) return await readProgress(sql, id, validator, await isDirector());
    const { event } = await getAccessibleEvent(id);
    const headers = { ETag: `"${event.revision}"`, 'Cache-Control': 'private, no-cache' };
    if (headers.ETag === validator) return new Response(null, { status: 304, headers });
    return Response.json(eventProgress(event), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
