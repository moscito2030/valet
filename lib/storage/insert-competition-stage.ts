import type { StoredCompetition } from '../competition-record';
import type { StoredEvent } from '../model';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { queueCompetition, queueStage } from './rows';
import { requireNormalizedStorage } from './switch';

export class DuplicateCompetitionName extends Error {
  constructor() {
    super('已有同名賽事。若要新增另一場，請指定 --allow-duplicate-name。');
  }
}

export class InactiveImportOrganizer extends Error {
  constructor() {
    super('指定的主辦單位不存在或未啟用。');
  }
}

export async function insertCompetitionWithStage(
  sql: Sql,
  competition: StoredCompetition,
  stage: StoredEvent,
  allowDuplicateName: boolean,
) {
  if (stage.event.parentEventId !== competition.competition.id)
    throw new Error('賽段的賽事 ID 不符');
  await requireNormalizedStorage(sql);
  const organizerId = stage.event.organizerId;
  if (organizerId !== undefined) {
    const rows = await sql`SELECT 1 FROM bridge_organizers
      WHERE id = ${organizerId} AND document->>'status' = 'active'`;
    if (!rows.length) throw new InactiveImportOrganizer();
  }
  const { sql: queue, batches } = captureSql();
  if (!allowDuplicateName) {
    // Serialize the name check with writes to either normalized competition representation.
    queue`LOCK TABLE bridge_competitions, bridge_stages IN SHARE ROW EXCLUSIVE MODE`;
    const name = competition.competition.name;
    queue`SELECT 1 / CASE WHEN EXISTS (
      SELECT 1 FROM bridge_competitions WHERE btrim(document->>'name') = ${name}
      UNION ALL
      SELECT 1 FROM bridge_stages
      WHERE id = competition_id AND btrim(settings->>'name') = ${name}
        AND NOT EXISTS (SELECT 1 FROM bridge_competitions WHERE bridge_competitions.id = bridge_stages.id)
    ) THEN 0 ELSE 1 END`;
  }
  queueCompetition(queue, competition, undefined, true);
  queueStage(queue, stage, {}, undefined, false, true);
  try {
    await commitSql(sql, batches);
  } catch (error) {
    if (!allowDuplicateName && (error as { code?: string }).code === '22012')
      throw new DuplicateCompetitionName();
    throw error;
  }
}
