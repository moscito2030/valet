import type { EventIndex, IndexEvent } from './event-index';
import type { BridgeEvent, CompetitionInfo, StoredEvent } from './model';
import { DomainError } from './events';
import { project } from './scoring';

export function competitionInfo(root: IndexEvent): CompetitionInfo {
  return { id: root.id, name: root.name, prefix: root.prefix ?? '', venue: root.venue, hasStages: !!root.hasStages, revision: root.revision };
}

export function stageSummary(event: IndexEvent) {
  return { id: event.id, revision: event.revision, name: event.stageName ?? event.name, date: event.date, endDate: event.endDate || event.date, kind: event.kind, gameMode: event.gameMode ?? 'bridge', pairMethod: event.pairMethod ?? 'mp', status: event.status, participants: event.participants.length, rounds: event.rounds, boards: event.boards.length };
}

export function competitionCatalog(data: EventIndex[]) {
  return data.filter(({ event }) => !event.parentEventId)
    .sort((a, b) => b.event.updatedAt.localeCompare(a.event.updatedAt))
    .map(({ event }) => {
      const stages = data.filter(s => s.event.id === event.id || s.event.parentEventId === event.id).map(s => stageSummary(s.event));
      const dates = [...new Set(stages.map(s => s.date))].sort();
      return { ...competitionInfo(event), date: dates[0], endDate: stages.map(s => s.endDate).sort().at(-1)!, dates, stages };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type Competition = ReturnType<typeof competitionCatalog>[number];

export function inheritCompetition(stored: StoredEvent, root: BridgeEvent): StoredEvent {
  return { ...stored, event: { ...stored.event, venue: root.venue, competition: competitionInfo(root) } };
}

export function appendStage(root: StoredEvent, stage: BridgeEvent, revision: number, firstStageName?: string): { root: StoredEvent; stage: StoredEvent } {
  if (root.event.parentEventId) throw new DomainError('賽段不能再建立子賽段');
  if (root.event.revision !== revision) throw new DomainError('賽事已更新，請重新載入', 409);
  if (!root.event.hasStages && !firstStageName?.trim()) throw new DomainError('請為原有成績指定第一賽段名稱');
  const next = structuredClone(root);
  next.event.hasStages = true;
  next.event.stageName ??= firstStageName?.trim() || root.event.name;
  next.event.revision++;
  next.event.updatedAt = new Date().toISOString();
  next.event.audit.push({ at: next.event.updatedAt, revision: next.event.revision, action: '新增賽段', reason: '裁判新增獨立賽段', detail: stage.name });
  const child = { ...stage, parentEventId: root.event.id, stageName: stage.name, venue: root.event.venue };
  delete child.competition;
  return { root: next, stage: { event: child, requests: [], projection: project(child) } };
}
