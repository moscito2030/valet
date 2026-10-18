import type { StoredCompetition } from './competition-record';
import type { EventIndex, IndexEvent } from './event-index';
import type { BridgeEvent, CompetitionInfo, StoredEvent } from './model';

export function competitionInfo(root: Pick<IndexEvent, 'id' | 'name' | 'prefix' | 'venue' | 'hasStages' | 'revision'> & { archived?: boolean }): CompetitionInfo {
  return { id: root.id, name: root.name, prefix: root.prefix ?? '', venue: root.venue, hasStages: !!root.hasStages, revision: root.revision, ...(root.archived !== undefined ? { archived: root.archived } : {}) };
}

export function stageSummary(event: IndexEvent) {
  return { id: event.id, revision: event.revision, name: event.stageName ?? event.name, date: event.date, endDate: event.endDate || event.date, kind: event.kind, gameMode: event.gameMode ?? 'bridge', pairMethod: event.pairMethod ?? 'mp', status: event.status, participants: event.participants.length, rounds: event.rounds, boards: event.boards.length };
}

export function competitionCatalog(data: EventIndex[], records: StoredCompetition[] = []) {
  const roots = new Map(data.filter(s => !s.event.parentEventId).map(s => [s.event.id, competitionInfo(s.event)]));
  for (const { competition } of records) roots.set(competition.id, competitionInfo(competition));
  return [...roots.values()].map(root => {
    const stages = data.filter(s => (s.event.parentEventId ?? s.event.id) === root.id)
      .map(s => ({ ...stageSummary(s.event), venue: s.event.venueOverride ?? root.venue }));
    const dates = [...new Set(stages.map(s => s.date))].sort();
    return { ...root, date: dates[0] ?? '', endDate: stages.map(s => s.endDate).sort().at(-1) ?? '', dates, stages };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

export type Competition = ReturnType<typeof competitionCatalog>[number];

export function inheritCompetition(stored: StoredEvent, root: Pick<BridgeEvent, 'id' | 'name' | 'prefix' | 'venue' | 'hasStages' | 'revision'> & { archived?: boolean }): StoredEvent {
  return { ...stored, event: { ...stored.event, prefix: root.prefix ?? '', venue: stored.event.venueOverride ?? root.venue, competition: competitionInfo(root) } };
}
