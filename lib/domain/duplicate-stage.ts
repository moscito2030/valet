import { randomUUID } from 'node:crypto';
import type { BridgeEvent } from '../model';

// Copy a stable source snapshot. All nested IDs are scoped to the new stage.
// Scores and settlement stay behind unless the caller explicitly asks for them.
export function duplicateStage(source: BridgeEvent, name: string, includeResults = false): BridgeEvent {
  const copy = structuredClone(source);
  copy.id = randomUUID();
  copy.name = name;
  copy.stageName = name;
  copy.parentEventId = source.parentEventId ?? source.id;
  delete copy.competition;
  delete copy.hasStages;
  copy.demo = false;
  copy.revision = 1;
  copy.updatedAt = new Date().toISOString();
  if (copy.club) copy.club.tokens = {};
  if (!includeResults) {
    copy.results = {};
    copy.penalties = {};
    copy.status = 'live';
    delete copy.currentRound;
    delete copy.roundPhase;
    if (copy.club) {
      copy.club.confirmations = {};
      copy.club.finalized = [];
      delete copy.club.publishedAssignments;
    }
    if (copy.knockout) copy.knockout.decisions = {};
    if (copy.swiss) {
      copy.swiss.publications = copy.swiss.publications.map((publication) => ({
        ...publication,
        basis: [],
        byeBasis: [],
        scores: [],
      }));
    }
  }
  copy.audit = [{
    at: copy.updatedAt,
    action: '複製賽段',
    reason: includeResults ? '建立完整賽段副本' : '複製賽段設定',
    revision: 1,
    detail: includeResults
      ? `來源賽段 ${source.id}，版本 ${source.revision}`
      : `來源賽段 ${source.id}，版本 ${source.revision}；未複製成績與結算`,
  }];
  return copy;
}
