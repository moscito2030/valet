import { randomUUID } from 'node:crypto';
import type { BridgeEvent } from '../model';

// Copy a stable source snapshot. All nested IDs are scoped to the new stage.
export function duplicateStage(source: BridgeEvent, name: string): BridgeEvent {
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
  copy.audit = [{ at: copy.updatedAt, action: '複製賽段', reason: '建立完整賽段副本', revision: 1,
    detail: `來源賽段 ${source.id}，版本 ${source.revision}` }];
  return copy;
}
