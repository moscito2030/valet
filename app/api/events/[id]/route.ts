import { canMutate } from '@/lib/mutation-permissions';
import { audienceEvent } from '@/lib/club-view';
import { NextResponse } from 'next/server';
import { mutateEvent } from '@/lib/store';
import { getAccessibleEvent as getEvent } from '@/lib/event-access';
import { mutationSchema } from '@/lib/model';
import { errorResponse, readJson, requireAdmin } from '@/lib/http';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/domain-error';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { event, projection } = await getEvent((await params).id);
    return NextResponse.json(
      audienceEvent(event, projection),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const command = mutationSchema.parse(await readJson(request));
    if (!canMutate(await isDirector() ? 'director' : 'admin', command))
      throw new DomainError('此操作需要裁判權限，俱樂部操作請使用專屬入口', 403);
    const id = (await params).id;
    await getEvent(id);
    const stored = await mutateEvent(id, command);
    return NextResponse.json(
      { revision: stored.event.revision },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
