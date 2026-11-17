import { NextResponse } from 'next/server';
import { competitionUpdateSchema } from '@/lib/competition-record';
import { competitionRedirect, mutateCompetition } from '@/lib/store';
import { errorResponse, requireAdmin, readJson } from '@/lib/http';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/domain-error';
export const dynamic = 'force-dynamic';

async function canonicalId(id: string) {
  return (await competitionRedirect(id)) ?? id;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const target = await competitionRedirect(id);
    if (!target) throw new DomainError('找不到賽事', 404);
    return NextResponse.redirect(new URL(`/api/competitions/${target}`, request.url), 308);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    if (!(await isDirector())) throw new DomainError('修改賽事資訊僅限裁判', 403);
    const stored = await mutateCompetition(await canonicalId((await params).id), competitionUpdateSchema.parse(await readJson(request)));
    return NextResponse.json({ revision: stored.competition.revision }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
