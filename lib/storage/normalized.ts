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
import { materializeStoredPublication } from '../board-publication';
import { DomainError } from '../domain-error';
import { eventIndex, type EventIndex } from '../event-index';
import type { BridgeEvent, Mutation, StoredEvent } from '../model';
import { storedWithProjection } from '../scoring';
import { applyMutation } from '../mutations/apply';
import { canonical, seedResultWrites } from './cell-write';
import { captureSql, commitSql, isConflict } from './batch';
import { normalizeResults } from '../result-status';
import { inheritCompetition } from '../competitions';
import { audienceEvent, audienceScoring } from '../read-models/public-event';
import { cachedProjection, scoreboardVersion } from './projection';
import { readOrganizerNames } from './organizer-names';
import { resolveCompetitionOrganizer } from '../competitions';
import type { Sql } from './neon';
import type { AgentWrite, EventRepository } from './repository';
import {
  loadCompetitions,
  loadStage,
  loadStages,
  queueCompetition,
  queueDeleteCompetition,
  queueDeleteStage,
  queueStage,
  type LoadedStage,
} from './rows';

function documentsOf(stages: LoadedStage[], competitions: StoredCompetition[]): StoredDocument[] {
  return [...stages.map((stage) => stage.stored), ...competitions];
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
        competition && document.competition.id === competition.id
          ? (competition.existed ? competition.revision : null)
          : undefined,
      );
      continue;
    }
    const prior = stages.find((stage) => stage.stored.event.id === document.event.id);
    if (prior?.stored === document) continue;
    queueStage(sql, document, {}, prior);
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

export function createNormalizedRepository(query: Sql) {
  const sql = () => query;
  async function family(tx: Sql, competitionId: string) {
    const [stages, competitions] = await Promise.all([
      loadStages(tx, competitionId), loadCompetitions(tx, competitionId),
    ]);
    return { stages, competitions };
  }
  async function listEvents() {
    return (await loadStages(sql())).map((stage) => materializeStoredPublication(stage.stored));
  }
  async function listEventIndex(): Promise<EventIndex[]> {
    const rows =
      await sql()`SELECT s.id, greatest(s.revision,
        (SELECT max(version) FROM bridge_assignments WHERE event_id = s.id),
        (SELECT max(version) FROM bridge_penalties WHERE event_id = s.id)) AS revision, s.settings, s.updated_at,
        (SELECT count(*)::int FROM bridge_results r WHERE r.event_id = s.id) AS received,
        (SELECT count(*)::int FROM bridge_assignments a,
           LATERAL jsonb_array_elements_text(a.document->'boards') b(board)
         WHERE a.event_id = s.id AND (NOT EXISTS (
           SELECT 1 FROM jsonb_each(s.settings->'knockout'->'decisions') d
           WHERE d.value->>'method' IN ('forfeit','withdrawal')
             AND starts_with(a.document->>'matchId', 'ko-' || d.key || '-r')
             AND substr(a.document->>'matchId', length(d.key) + 6) ~ '^[0-9]+$'
         ) OR EXISTS (SELECT 1 FROM bridge_results r WHERE r.event_id = s.id
           AND r.assignment_id = a.assignment_id AND r.board = b.board::int))) AS expected
        FROM bridge_stages s ORDER BY s.updated_at DESC, s.id`;
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
        updatedAt: settings.updatedAt ?? new Date(String(row.updated_at)).toISOString(),
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
        projection: { received: Number(row.received), expected: Number(row.expected) },
      });
    });
  }
  async function getCompetition(id: string, history = true): Promise<StoredCompetition> {
    const [saved] = await loadCompetitions(sql(), id, history);
    if (saved) return saved;
    const [root] = await sql()`SELECT settings->>'name' AS name, settings->>'venue' AS venue,
      coalesce(settings->>'updatedAt', updated_at::text) AS updated_at,
      greatest(revision, (SELECT max(version) FROM bridge_assignments WHERE event_id = ${id}),
        (SELECT max(version) FROM bridge_penalties WHERE event_id = ${id})) AS revision
      FROM bridge_stages WHERE id = ${id} AND competition_id = ${id}`;
    if (!root) throw new DomainError('找不到賽事', 404);
    return { requests: [], competition: { id, name: String(root.name), venue: String(root.venue ?? ''),
      hasStages: true, revision: Number(root.revision), updatedAt: new Date(String(root.updated_at)).toISOString(), audit: [] } };
  }
  async function getEvent(id: string, history = true, rankings = true): Promise<StoredEvent> {
    const stage = await loadStage(sql(), id, history);
    if (!stage) throw new DomainError('找不到賽事', 404);
    const competitionId = stageCompetitionId(stage.stored.event);
    const [root, assignments, names] = await Promise.all([
      getCompetition(competitionId, history),
      sql()`SELECT settings->>'organizerId' AS organizer_id FROM bridge_stages
        WHERE competition_id = ${competitionId}`,
      readOrganizerNames(sql(), competitionId),
    ]);
    const organizer = resolveCompetitionOrganizer(assignments.map(row => row.organizer_id), names);
    const stored = materializeStoredPublication(stage.stored);
    const event = { ...stored.event, results: normalizeResults(stored.event.results) };
    const projection = rankings ? await cachedProjection(query, event, 'full') : null;
    if (rankings && !projection) return getEvent(id, history, rankings);
    const record = projection ? { event, requests: stored.requests, projection } : storedWithProjection(event, stored.requests);
    return inheritCompetition(record,
      root.competition, organizer.name);
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
    const families = await Promise.all(input.competitions.map(c => family(sql(), c.id)));
    const targets = deletionTargets(families.flatMap(f => documentsOf(f.stages, f.competitions)), input);
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
    const stored = storedWithProjection(event, []);
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
    return (await loadStage(sql(), event.id))!.stored;
  }
  async function mutateEvent(id: string, command: Mutation, agent?: AgentWrite): Promise<StoredEvent> {
    if (command.action === 'competition-settings' && !agent) {
      await mutateCompetition(id, {
        name: command.name,
        venue: command.venue,
        revision: command.revision,
        requestId: command.requestId,
      });
      return getEvent(id, true, false);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const loaded = await loadStage(sql(), id);
      if (!loaded) throw new DomainError('找不到賽事', 404);
      const stored = materializeStoredPublication(loaded.stored);
      agent?.validate(stored);
      if (stored.requests.includes(command.requestId)) return stored;
      const cap = captureSql();
      const next = applyMutation(stored, { ...command, revision: stored.event.revision }, true);
      try {
        const raw = loaded.stored.event;
        const persisted = { ...next.event, results: { ...next.event.results } };
        if ('publishBoards' in raw) {
          Object.assign(persisted, { publishBoards: raw.publishBoards });
          const materialized = new Map(stored.event.boards.map(board => [board.number, board]));
          const original = new Map(raw.boards.map(board => [board.number, board]));
          persisted.boards = persisted.boards.map(board =>
            canonical(board) === canonical(materialized.get(board.number)) ? original.get(board.number)! : board);
        }
        for (const [key, old] of Object.entries(raw.results))
          if (old.status === 'average' && canonical({ ...old, status: 'cancelled' }) === canonical(persisted.results[key]))
            persisted.results[key] = old;
        queueStage(cap.sql, storedWithProjection(persisted, next.requests), {}, loaded, command);
        agent?.queue(cap.sql, stored, next);
        const batches = await commitSql(sql(), cap.batches);
        next.event.revision = Number(batches.find(rows => rows[0]?.data_version)?.[0].data_version);
        next.event.audit.at(-1)!.revision = next.event.revision;
        return next;
      } catch (error) {
        if (agent && (error as { code?: string }).code === '23505') throw error;
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
    const stored = storedWithProjection(child, []);
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await family(sql(), parentId);
      const data = documentsOf(current.stages, current.competitions);
      if (data.filter(isStage).filter((item) => stageCompetitionId(item.event) === parentId).length >= 32)
        throw new DomainError('賽事或賽段已更新，或已達 32 個賽段上限，請重新載入', 409);
      const previous = findCompetition(data, parentId);
      const next = advanceCompetition(previous, revision, '新增賽段');
      const conflict = await writeOnce(sql(), (cap) => {
        const existing = current.competitions.length > 0;
        if (!existing) {
          // Legacy competition metadata shares the root stage data version.
          cap`WITH root AS (
            SELECT id FROM bridge_stages WHERE id = ${parentId} AND greatest(revision,
              (SELECT max(version) FROM bridge_assignments WHERE event_id = ${parentId}),
              (SELECT max(version) FROM bridge_penalties WHERE event_id = ${parentId})) = ${revision} FOR UPDATE
          ) SELECT 1 / (SELECT count(*)::int FROM root)`;
        }
        queueCompetition(cap, next, existing ? revision : null);
        queueStage(cap, stored, seedResultWrites(child));
      });
      if (!conflict) return (await loadStage(sql(), child.id))!.stored;
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
  } satisfies EventRepository;
}


export async function readScoreboard(sql: Sql, id: string, validator: string | null, director: boolean) {
  const version = await scoreboardVersion(sql, id, director);
  const headers = { ETag: version, 'Cache-Control': 'private, no-cache' };
  if (validator === version) return new Response(null, { status: 304, headers });
  const repo = createNormalizedRepository(sql);
  for (;;) {
    const { event, projection } = await repo.getEvent(id, false);
    if ((event.stageArchived || event.competition?.archived) && !director) throw new DomainError('找不到賽事', 404);
    const scoring = audienceScoring(event, projection);
    const publicProjection = await cachedProjection(sql, scoring, 'public');
    if (!publicProjection) continue;
    headers.ETag = `"${event.revision}.${event.competition?.revision ?? event.revision}"`;
    return Response.json(audienceEvent(event, projection, publicProjection, scoring), { headers });
  }
}
