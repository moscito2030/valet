import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/domain-error';
import { duplicateStage } from '@/lib/domain/duplicate-stage';
import { getAccessibleEvent } from '@/lib/event-access';
import { getCompetition, insertStage } from '@/lib/store';
import { errorResponse, readJson, requireAdmin } from '@/lib/http';

export const dynamic = 'force-dynamic';
const schema = z.object({ name: z.string().trim().min(1).max(80), revision: z.number().int().positive() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    if (!(await isDirector())) throw new DomainError('複製賽段僅限裁判', 403);
    const input = schema.parse(await readJson(request));
    const { event } = await getAccessibleEvent((await params).id);
    if (event.revision !== input.revision) throw new DomainError('賽段已更新，請重新載入後再複製', 409);
    const parent = await getCompetition(event.parentEventId ?? event.id);
    const saved = await insertStage(parent.competition.id, duplicateStage(event, input.name), parent.competition.revision);
    return NextResponse.json({ id: saved.event.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}
