import { NextResponse } from 'next/server';
import { competitionUpdateSchema } from '@/lib/competition-record';
import { mutateCompetition } from '@/lib/store';
import { errorResponse, requireAdmin, readJson } from '@/lib/http';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/events';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    if (!(await isDirector())) throw new DomainError('修改賽事資訊僅限裁判', 403);
    const stored = await mutateCompetition((await params).id, competitionUpdateSchema.parse(await readJson(request)));
    return NextResponse.json({ revision: stored.competition.revision }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
