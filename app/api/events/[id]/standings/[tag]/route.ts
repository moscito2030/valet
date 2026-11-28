import { isDirector } from '@/lib/auth';
import { getAccessibleEvent } from '@/lib/event-access';
import { errorResponse } from '@/lib/http';
import { publicSnapshot } from '@/lib/read-models/public-event';
import { readScoreboard } from '@/lib/storage/normalized';
import { normalizedSql } from '@/lib/store';

export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; tag: string }> }) {
  try {
    const { id, tag } = await params;
    const sql = normalizedSql();
    if (sql) return await readScoreboard(sql, id, null, await isDirector(), tag);
    const { event, projection } = await getAccessibleEvent(id);
    return Response.json(publicSnapshot(event, projection), { headers: { 'Cache-Control': 'private, no-cache' } });
  } catch (error) {
    return errorResponse(error);
  }
}
