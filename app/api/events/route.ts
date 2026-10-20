import { NextResponse } from 'next/server';
import { createSchema } from '@/lib/model';
import { createEvent } from '@/lib/events';
import { insertEvent, listEventIndex, listCompetitionRecords, storageMode } from '@/lib/store';
import { competitionCatalog } from '@/lib/competitions';
import { errorResponse, readJson, requireAdmin } from '@/lib/http';
import { isDirector } from '@/lib/auth';
import { DomainError } from '@/lib/domain-error';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const [data, records] = await Promise.all([listEventIndex(), listCompetitionRecords()]);
    const director = await isDirector();
    const roots = new Map(competitionCatalog(data, records).map(c => [c.id, c]));
    return NextResponse.json(
      {
        storage: storageMode(),
        events: [...data]
          .filter(({ event }) => director || (!event.stageArchived && !roots.get(event.parentEventId ?? event.id)?.archived))
          .sort((a, b) => Date.parse(b.event.updatedAt) - Date.parse(a.event.updatedAt))
          .map(({ event: e, projection: p }) => ({
            id: e.id,
            name: e.name,
            prefix: roots.get(e.parentEventId ?? e.id)?.prefix ?? e.prefix ?? '',
            updatedAt: e.updatedAt,
            competitionRevision: roots.get(e.parentEventId ?? e.id)?.revision,
            kind: e.kind,
            pairMethod: e.pairMethod ?? 'mp',
            date: e.date,
            endDate: e.endDate,
            venue: e.venueOverride ?? roots.get(e.parentEventId ?? e.id)?.venue ?? e.venue,
            status: e.status,
            demo: e.demo,
            participants: e.participants.length,
            rounds: e.rounds,
            boards: e.boards.length,
            received: p.received,
            expected: p.expected,
          })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    if (!(await isDirector())) throw new DomainError('建立賽事僅限裁判', 403);
    const event = createEvent(createSchema.parse(await readJson(request)));
    await insertEvent(event);
    return NextResponse.json({ id: event.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
