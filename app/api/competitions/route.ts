import { NextResponse } from 'next/server';
import { listEventIndex, listCompetitionRecords, insertCompetition } from '@/lib/store';
import { createCompetition, competitionSchema } from '@/lib/competition-record';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/events';
import { competitionCatalog } from '@/lib/competitions';
import { errorResponse, requireAdmin, readJson } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const [stages, records] = await Promise.all([listEventIndex(), listCompetitionRecords()]);
    return NextResponse.json({ competitions: competitionCatalog(stages, records) }, { headers: { 'Cache-Control': 'no-store' } });
  }
  catch (e) { return errorResponse(e); }
}
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    if (!(await isDirector())) throw new DomainError('建立賽事僅限裁判', 403);
    const stored = await insertCompetition(createCompetition(competitionSchema.parse(await readJson(request))));
    return NextResponse.json({ id: stored.competition.id }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
