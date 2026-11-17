import type { z } from 'zod';
import { deletionTargets, type CompetitionDeletion } from '../competition-deletion';
import {
  advanceCompetition,
  competitionKey,
  competitionUpdateSchema,
  findCompetition,
  isStage,
  saveCompetitionRecord,
  stageCompetitionId,
  updateCompetition,
  type StoredCompetition,
  type StoredDocument,
} from '../competition-record';
import { DomainError } from '../domain-error';
import { eventIndex, type EventIndex } from '../event-index';
import type { BridgeEvent, Mutation, StoredEvent } from '../model';
import { project } from '../scoring';
import { commitDocumentMutation, seedResultWrites } from './cell-write';
import { captureSql, commitSql, isConflict } from './batch';
import { hydrateEvent } from './hydrate-event';
import type { Sql } from './neon';
import type { EventRepository } from './repository';
import {
  loadCompetitions,
  loadStage,
  loadStages,
  queueCompetition,
  queueDeleteCompetition,
  queueDeleteStage,
  queueStage,
  saveStage,
  type LoadedStage,
  type StagePrior,
} from './rows';

function documentsOf(stages: LoadedStage[], competitions: StoredCompetition[]): StoredDocument[] {
  return [...stages.map((stage) => stage.stored), ...competitions];
}

function priorOf(stage: LoadedStage): StagePrior {
  return {
    eventRevision: stage.stored.event.revision,
    writes: stage.writes,
    revisions: stage.revisions,
    results: stage.stored.event.results,
  };
}

function queueSaved(
  sql: Sql,
  stages: LoadedStage[],
  documents: StoredDocument[],
  competition?: { id: string; revision: number; existed: boolean },
) {
  for (const document of documents) {
    if (!isStage(document)) {
      queueCompetition(
        sql,
        document,
        competition && document.competition.id === competition.id && competition.existed
          ? competition.revision
          : undefined,
      );
      continue;
    }
    const prior = stages.find((stage) => stage.stored.event.id === document.event.id);
    if (prior?.stored === document) continue;
    queueStage(
      sql,
      document,
      prior?.writes ?? seedResultWrites(document.event),
      prior ? priorOf(prior) : undefined,
    );
  }
}

async function writeOnce(sql: Sql, run: (cap: Sql) => void) {
  const cap = captureSql();
  run(cap.sql);
  try {
    await commitSql(sql, cap.batches);
    return false;
  } catch (error) {
    if (!isConflict(error)) throw error;
    return true;
  }
}

async function competitionCount(sql: Sql) {
  const rows = await sql`SELECT count(*)::int AS n FROM (
    SELECT id FROM bridge_competitions
    UNION
    SELECT competition_id AS id FROM bridge_stages
  ) ids`;
  return Number(rows[0]?.n ?? 0);
}

export function createNormalizedRepository(query: Sql): EventRepository {
  const sql = () => query;
  async function family(tx: Sql, competitionId: string) {
    const [stages, competitions] = await Promise.all([loadStages(tx), loadCompetitions(tx)]);
    return {
      stages: stages.filter(
        (stage) =>
          stageCompetitionId(stage.stored.event) === competitionId ||
          stage.stored.event.id === competitionId,
      ),
      competitions: competitions.filter((item) => item.competition.id === competitionId),
    };
  }
  async function listEvents() {
    return (await loadStages(sql())).map((stage) => stage.stored);
  }
  async function listEventIndex(): Promise<EventIndex[]> {
    const rows =
      await sql()`SELECT id, revision, settings, projection FROM bridge_stages ORDER BY updated_at DESC, id`;
    const [participants, boards] = await Promise.all([
      sql()`SELECT event_id, participant_id FROM bridge_participants ORDER BY event_id, ordinal`,
      sql()`SELECT event_id, board_number FROM bridge_boards ORDER BY event_id, ordinal`,
    ]);
    return rows.map((row) => {
      const settings = row.settings as BridgeEvent;
      const id = String(row.id);
      const event: BridgeEvent = {
        ...settings,
        id,
        revision: Number(row.revision),
        participants: participants
          .filter((item) => item.event_id === id)
          .map((item) => ({ id: String(item.participant_id), name: '', players: '' })),
        boards: boards
          .filter((item) => item.event_id === id)
          .map((item) => ({
            number: Number(item.board_number),
            dealer: 'N',
            vulnerability: 'None',
            deal: { N: [], E: [], S: [], W: [] },
          })),
        assignments: [],
        results: {},
        audit: [],
      };
      return eventIndex({
        event,
        projection: row.projection as StoredEvent['projection'],
        requests: [],
      });
    });
  }
  async function getCompetition(id: string): Promise<StoredCompetition> {
    const saved = (await loadCompetitions(sql())).find((item) => item.competition.id === id);
    if (saved) return saved;
    const stage = await loadStage(sql(), id);
    if (!stage || stage.stored.event.parentEventId) throw new DomainError('找不到賽事', 404);
    return findCompetition([stage.stored], id);
  }
  async function getEvent(id: string) {
    const stage = await loadStage(sql(), id);
    if (!stage) throw new DomainError('找不到賽事', 404);
    const root = await getCompetition(stageCompetitionId(stage.stored.event));
    return hydrateEvent(stage.stored, root.competition);
  }
  async function deleteEvent(id: string, revision: number) {
    const stage = await loadStage(sql(), id);
    if (!stage) throw new DomainError('找不到賽事', 404);
    if (stage.stored.event.revision !== revision) throw new DomainError('賽段已更新，請重新載入', 409);
    const competitionId = stageCompetitionId(stage.stored.event);
    const current = await family(sql(), competitionId);
    const data = documentsOf(current.stages, current.competitions);
    const previous = findCompetition(data, competitionId);
    const next = advanceCompetition(previous, previous.competition.revision, '刪除賽段');
    const saved = saveCompetitionRecord(
      data.filter((document) => !isStage(document) || document.event.id !== id),
      next,
    );
    const conflict = await writeOnce(sql(), (cap) => {
      queueDeleteStage(cap, id, revision);
      queueSaved(cap, current.stages, saved, {
        id: competitionId,
        revision: previous.competition.revision,
        existed: current.competitions.some((item) => item.competition.id === competitionId),
      });
    });
    if (conflict) throw new DomainError('賽段已更新，請重新載入', 409);
  }
  async function deleteCompetitions(input: CompetitionDeletion) {
    const stages = await loadStages(sql());
    const competitions = await loadCompetitions(sql());
    const targets = deletionTargets(documentsOf(stages, competitions), input);
    const conflict = await writeOnce(sql(), (cap) => {
      for (const target of targets) {
        if (target.id.startsWith('competition:'))
          queueDeleteCompetition(cap, target.id.slice(competitionKey('').length), target.revision);
        else queueDeleteStage(cap, target.id, target.revision);
      }
    });
    if (conflict) throw new DomainError('賽事已更新，請重新載入清單後再刪除', 409);
    return input.competitions.length;
  }
  async function insertEvent(event: BridgeEvent) {
    const stored = { event, projection: project(event), requests: [] as string[] };
    const metadata = findCompetition([stored], event.id);
    if ((await competitionCount(sql())) >= 50) throw new DomainError('最多 50 場賽事');
    await commitSql(
      sql(),
      (() => {
        const cap = captureSql();
        queueCompetition(cap.sql, metadata);
        queueStage(cap.sql, stored, seedResultWrites(event));
        return cap.batches;
      })(),
    );
    return stored;
  }
  async function mutateEvent(id: string, command: Mutation): Promise<StoredEvent> {
    if (command.action === 'competition-settings') {
      await mutateCompetition(id, {
        name: command.name,
        prefix: command.prefix,
        venue: command.venue,
        revision: command.revision,
        requestId: command.requestId,
      });
      return getEvent(id);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const loaded = await loadStage(sql(), id);
      if (!loaded) throw new DomainError('找不到賽事', 404);
      if (loaded.stored.requests.includes(command.requestId)) return loaded.stored;
      const next = commitDocumentMutation(loaded.stored, command, loaded.writes, true);
      try {
        await saveStage(sql(), next.stored, next.writes, priorOf(loaded));
        return next.stored;
      } catch (error) {
        if (!isConflict(error) || attempt === 5)
          throw isConflict(error)
            ? new DomainError('賽段版本已更新，請重新載入後再提交。', 409, 'stage-revision')
            : error;
      }
    }
    throw new DomainError('賽段版本已更新，請重新載入後再提交。', 409, 'stage-revision');
  }
  async function listCompetitionRecords() {
    return loadCompetitions(sql());
  }
  async function insertCompetition(stored: StoredCompetition) {
    if ((await competitionCount(sql())) >= 50) throw new DomainError('最多 50 場賽事');
    const cap = captureSql();
    queueCompetition(cap.sql, stored);
    await commitSql(sql(), cap.batches);
    return stored;
  }
  async function mutateCompetition(id: string, input: z.infer<typeof competitionUpdateSchema>) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await family(sql(), id);
      const data = documentsOf(current.stages, current.competitions);
      const previous = findCompetition(data, id);
      const next = updateCompetition(previous, input, true);
      if (next === previous) return next;
      const conflict = await writeOnce(sql(), (cap) =>
        queueSaved(cap, current.stages, saveCompetitionRecord(data, next), {
          id,
          revision: previous.competition.revision,
          existed: current.competitions.some((item) => item.competition.id === id),
        }),
      );
      if (!conflict) return next;
    }
    throw new DomainError('賽事已更新，請重新載入', 409);
  }
  async function insertStage(parentId: string, stage: BridgeEvent, revision: number) {
    const child = { ...stage, parentEventId: parentId, stageName: stage.name };
    delete child.competition;
    const stored = { event: child, projection: project(child), requests: [] as string[] };
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await family(sql(), parentId);
      const data = documentsOf(current.stages, current.competitions);
      if (data.filter(isStage).filter((item) => stageCompetitionId(item.event) === parentId).length >= 32)
        throw new DomainError('賽事或賽段已更新，或已達 32 個賽段上限，請重新載入', 409);
      const previous = findCompetition(data, parentId);
      const next = advanceCompetition(previous, revision, '新增賽段');
      const conflict = await writeOnce(sql(), (cap) => {
        queueSaved(cap, current.stages, saveCompetitionRecord(data, next), {
          id: parentId,
          revision: previous.competition.revision,
          existed: current.competitions.some((item) => item.competition.id === parentId),
        });
        queueStage(cap, stored, {});
      });
      if (!conflict) return stored;
    }
    throw new DomainError('賽事或賽段已更新，或已達 32 個賽段上限，請重新載入', 409);
  }
  return {
    listEvents,
    listEventIndex,
    getEvent,
    deleteEvent,
    deleteCompetitions,
    insertEvent,
    mutateEvent,
    listCompetitionRecords,
    getCompetition,
    insertCompetition,
    mutateCompetition,
    insertStage,
  };
}
