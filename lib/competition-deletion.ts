import { z } from 'zod';
import { competitionKey, findCompetition, isStage, stageCompetitionId, type StoredDocument } from './competition-record';
import { DomainError } from './events';

export const deletionSchema = z.object({
  competitions: z.array(z.object({
    id: z.string().min(1).max(100),
    confirmName: z.string().min(1).max(80),
    revision: z.number().int().positive().optional(),
    stages: z.array(z.object({ id: z.string().min(1).max(100), revision: z.number().int().positive() }).strict()).max(32),
  }).strict()).min(1).max(50),
}).strict();
export type CompetitionDeletion = z.infer<typeof deletionSchema>;

export function deletionTargets(data: StoredDocument[], input: CompetitionDeletion) {
  const ids = input.competitions.map(c => c.id);
  if (new Set(ids).size !== ids.length) throw new DomainError('請勿重複選取賽事');
  return input.competitions.flatMap(c => {
    let root;
    try { root = findCompetition(data, c.id); }
    catch { throw new DomainError('賽事已變更，請重新載入清單', 409); }
    const independent = data.some(d => !isStage(d) && d.competition.id === c.id);
    if ((independent || c.revision !== undefined) && c.revision !== root.competition.revision)
      throw new DomainError('賽事已更新，請重新載入清單', 409);
    if (c.confirmName !== root.competition.name) throw new DomainError('請輸入完整比賽名稱以確認刪除');
    const family = data.filter(isStage).filter(s => stageCompetitionId(s.event) === c.id);
    if (new Set(c.stages.map(s => s.id)).size !== c.stages.length || family.length !== c.stages.length ||
      family.some(s => !c.stages.some(expected => expected.id === s.event.id && expected.revision === s.event.revision))) {
      throw new DomainError('賽事或賽段已更新，請重新載入清單後再刪除', 409);
    }
    return [...c.stages, ...(independent ? [{ id: competitionKey(c.id), revision: root.competition.revision }] : [])];
  });
}
