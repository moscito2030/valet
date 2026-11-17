import type { StoredCompetition } from './competition-record';
import type { EventIndex, IndexEvent } from './event-index';
import type { BridgeEvent, CompetitionInfo, StoredEvent } from './model';

type StatusStage = {
  stageArchived?: boolean;
  status: BridgeEvent['status'];
  rounds: number;
};

/**
 * Aggregate status for an event. The home page and the competition catalog both
 * use this. Archived stages do not count: a finished event stays 「已結束」 when
 * a sealed rehearsal is still in review, and a live stage stays 「進行中」 when
 * a sealed stage is in review.
 *
 * When every stage is archived, the label is 「已封存 · 僅裁判可見」, the same
 * label as archiving the whole competition. It is not 「尚未安排賽段」, and it
 * does not copy those stages' own live, review, or finished status. A
 * competition with no stages at all stays 「尚未安排賽段」. Stored stage status
 * is left unchanged.
 */
export function competitionStatusLabel(
  competition: { archived?: boolean },
  stages: readonly StatusStage[],
): string {
  if (competition.archived) return '已封存 · 僅裁判可見';
  const active = stages.filter((stage) => !stage.stageArchived);
  if (stages.length > 0 && active.length === 0) return '已封存 · 僅裁判可見';
  if (active.length === 0) return '尚未安排賽段';
  if (active.every((stage) => stage.status === 'finished')) return '已結束';
  if (active.every((stage) => stage.status === 'finished' || stage.status === 'review'))
    return '成績覆核中';
  if (active.every((stage) => !stage.rounds)) return '待設定賽程';
  return '進行中';
}

export function competitionInfo(root: Pick<IndexEvent, 'id' | 'name' | 'prefix' | 'venue' | 'hasStages' | 'revision'> & { archived?: boolean }): CompetitionInfo {
  return { id: root.id, name: root.name, prefix: root.prefix ?? '', venue: root.venue, hasStages: !!root.hasStages, revision: root.revision, ...(root.archived !== undefined ? { archived: root.archived } : {}) };
}

export function stageSummary(event: IndexEvent) {
  return { stageArchived: event.stageArchived, id: event.id, revision: event.revision, name: event.stageName ?? event.name, date: event.date, endDate: event.endDate || event.date, kind: event.kind, gameMode: event.gameMode ?? 'bridge', teamMethod: event.teamMethod, teamFormat: event.teamFormat, bam: event.bam, pairMethod: event.pairMethod ?? 'mp', status: event.status, participants: event.participants.length, rounds: event.rounds, boards: event.boards.length };
}

export function competitionCatalog(data: EventIndex[], records: StoredCompetition[] = [], includeArchivedStages = true) {
  const roots = new Map(data.filter(s => !s.event.parentEventId).map(s => [s.event.id, competitionInfo(s.event)]));
  for (const { competition } of records) roots.set(competition.id, competitionInfo(competition));
  return [...roots.values()].map(root => {
    const allStages = data.filter(s => (s.event.parentEventId ?? s.event.id) === root.id)
      .map(s => ({ ...stageSummary(s.event), venue: s.event.venueOverride ?? root.venue }));
    const stages = includeArchivedStages ? allStages : allStages.filter(s => !s.stageArchived);
    const dates = [...new Set(stages.map(s => s.date))].sort();
    return {
      ...root,
      date: dates[0] ?? '',
      endDate: stages.map(s => s.endDate).sort().at(-1) ?? '',
      dates,
      stages,
      statusLabel: competitionStatusLabel(root, allStages),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export type Competition = ReturnType<typeof competitionCatalog>[number];

export function inheritCompetition(stored: StoredEvent, root: Pick<BridgeEvent, 'id' | 'name' | 'prefix' | 'venue' | 'hasStages' | 'revision'> & { archived?: boolean }): StoredEvent {
  return { ...stored, event: { ...stored.event, prefix: root.prefix ?? '', venue: stored.event.venueOverride ?? root.venue, competition: competitionInfo(root) } };
}
