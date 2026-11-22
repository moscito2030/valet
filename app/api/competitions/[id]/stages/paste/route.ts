import { NextResponse } from 'next/server';
import { isDirector } from '@/lib/auth';
import { stageCompetitionId } from '@/lib/competition-record';
import { resolveCompetitionOrganizer } from '@/lib/competitions';
import { DomainError } from '@/lib/domain-error';
import { pasteStage } from '@/lib/domain/paste-stage';
import { getAccessibleEvent } from '@/lib/event-access';
import { errorResponse, readJson, requireAdmin } from '@/lib/http';
import { pasteStageSchema } from '@/lib/paste-stage-input';
import { competitionRedirect, getCompetition, insertStage, listEventIndex } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    try {
      await requireAdmin(request);
    } catch (error) {
      if (error instanceof DomainError && error.status === 401)
        throw new DomainError('貼上賽段僅限裁判', 401);
      throw error;
    }
    if (!(await isDirector())) throw new DomainError('貼上賽段僅限裁判', 403);
    const input = pasteStageSchema.parse(await readJson(request));
    const { event } = await getAccessibleEvent(input.sourceId);
    if (event.revision !== input.sourceRevision)
      throw new DomainError('來源賽段已更新，請重新載入後再貼上', 409);

    const { id } = await params;
    const targetId = (await competitionRedirect(id)) ?? id;
    const { competition } = await getCompetition(targetId);
    const sameCompetition = stageCompetitionId(event) === targetId;
    const stage = pasteStage(event, { name: input.name, include: input.include, sameCompetition });
    stage.parentEventId = sameCompetition ? stageCompetitionId(event) : targetId;
    stage.venue = competition.venue;
    const organizerIds = (await listEventIndex())
      .filter(({ event }) => stageCompetitionId(event) === targetId)
      .map(({ event }) => event.organizerId);
    stage.organizerId = resolveCompetitionOrganizer(organizerIds, new Map()).id;
    const saved = await insertStage(targetId, stage, input.revision);
    return NextResponse.json({ id: saved.event.id }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
