import type { z } from 'zod';
import { deletionTargets, type CompetitionDeletion } from '../competition-deletion';
import {
  advanceCompetition,
  competitionKey,
  competitionUpdateSchema,
  findCompetition,
  stageCompetitionId,
  updateCompetition,
  type StoredCompetition,
  type StoredDocument,
} from '../competition-record';
import { DomainError } from '../domain-error';
import { type EventIndex } from '../event-index';
import { BridgeEvent, Mutation, StoredEvent } from '../model';
import { applyMutation } from '../mutations/apply';
import { project } from '../scoring';
import { hydrateEvent } from './hydrate-event';
import type { EventRepository } from './repository';

export type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

export function createNeonRepository(query: Sql): EventRepository {
  const sql = () => query;
  async function getRawEvent(id: string): Promise<StoredEvent> {
    const rows =
      await sql()`SELECT document FROM bridge_events WHERE id=${id} AND document ? 'event'`;
    if (!rows.length) throw new DomainError('找不到賽事', 404);
    return rows[0].document as StoredEvent;
  }
  async function listEvents(): Promise<StoredEvent[]> {
    const rows =
      await sql()`SELECT document FROM bridge_events WHERE document ? 'event' ORDER BY updated_at DESC`;
    return rows.map((r) => r.document as StoredEvent);
  }
  async function listEventIndex(): Promise<EventIndex[]> {
    const rows =
      await sql()`SELECT jsonb_build_object('id', document->'event'->'id','name', document->'event'->'name','prefix', document->'event'->'prefix','updatedAt', document->'event'->'updatedAt','kind', document->'event'->'kind','gameMode', document->'event'->'gameMode','pairMethod', document->'event'->'pairMethod','date', document->'event'->'date','endDate', document->'event'->'endDate','venue', document->'event'->'venue','venueOverride', document->'event'->'venueOverride','status', document->'event'->'status','demo', document->'event'->'demo','rounds', document->'event'->'rounds','parentEventId', document->'event'->'parentEventId','stageName', document->'event'->'stageName','hasStages', document->'event'->'hasStages','revision', document->'event'->'revision', 'participants', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p->'id')) FROM jsonb_array_elements(document->'event'->'participants') p), '[]'::jsonb), 'boards', COALESCE((SELECT jsonb_agg(jsonb_build_object('number', b->'number')) FROM jsonb_array_elements(document->'event'->'boards') b), '[]'::jsonb)) AS event, jsonb_build_object('received', document->'projection'->'received', 'expected', document->'projection'->'expected') AS projection FROM bridge_events WHERE document ? 'event' ORDER BY updated_at DESC`;
    return rows.map((r) => ({
      event: r.event as EventIndex['event'],
      projection: r.projection as EventIndex['projection'],
    }));
  }
  async function getEvent(id: string): Promise<StoredEvent> {
    const stored = await getRawEvent(id);
    const root = await getCompetition(stageCompetitionId(stored.event));
    return hydrateEvent(stored, root.competition);
  }
  async function deleteEvent(id: string, revision: number) {
    const stage = await getRawEvent(id);
    if (stage.event.revision !== revision) throw new DomainError('賽段已更新，請重新載入', 409);
    const previous = await getCompetition(stageCompetitionId(stage.event));
    await writeFamily(
      previous,
      advanceCompetition(previous, previous.competition.revision, '刪除賽段'),
      undefined,
      { id, revision },
    );
  }
  async function deleteCompetitions(input: CompetitionDeletion) {
    const targets = deletionTargets(
      [...(await listEvents()), ...(await listCompetitionRecords())],
      input,
    );
    const roots = input.competitions.map((c) => c.id);
    const rows = await sql()`WITH expected AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) AS x(id text, revision integer)
  ), locked AS MATERIALIZED (
    SELECT id, revision FROM bridge_events
    WHERE id IN (SELECT id FROM expected)
      OR document->'event'->>'parentEventId' IN (SELECT jsonb_array_elements_text(${JSON.stringify(roots)}::jsonb))
      OR document->'competition'->>'id' IN (SELECT jsonb_array_elements_text(${JSON.stringify(roots)}::jsonb))
    ORDER BY CASE WHEN document ? 'competition' OR id IN (SELECT jsonb_array_elements_text(${JSON.stringify(roots)}::jsonb)) THEN 0 ELSE 1 END, id FOR UPDATE
  ), valid AS (
    SELECT 1 WHERE (SELECT count(*) FROM locked) = (SELECT count(*) FROM expected)
      AND NOT EXISTS (SELECT 1 FROM expected e LEFT JOIN locked l ON l.id=e.id AND l.revision=e.revision WHERE l.id IS NULL)
  ) DELETE FROM bridge_events WHERE id IN (SELECT id FROM locked) AND EXISTS (SELECT 1 FROM valid) RETURNING id`;
    if (rows.length !== targets.length)
      throw new DomainError('賽事已更新，請重新載入清單後再刪除', 409);
    return input.competitions.length;
  }
  async function insertEvent(event: BridgeEvent) {
    const stored = { event, projection: project(event), requests: [] };
    const metadata = findCompetition([stored], event.id);
    await sql()`INSERT INTO bridge_events (id,revision,document) VALUES (${event.id},${event.revision},${JSON.stringify(stored)}::jsonb), (${competitionKey(event.id)},${metadata.competition.revision},${JSON.stringify(metadata)}::jsonb)`;
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
    const previous = await getRawEvent(id),
      next = applyMutation(previous, command);
    if (next === previous) return previous;
    const rows =
      await sql()`UPDATE bridge_events SET document=${JSON.stringify(next)}::jsonb,revision=${next.event.revision},updated_at=now() WHERE id=${id} AND revision=${command.revision} RETURNING id`;
    if (!rows.length) {
      const current = await getEvent(id);
      if (current.requests.includes(command.requestId)) return current;
      throw new DomainError('另一個操作已更新成績，請重新載入。', 409);
    }
    return next;
  }
  async function listCompetitionRecords(): Promise<StoredCompetition[]> {
    const rows = await sql()`SELECT document FROM bridge_events WHERE document ? 'competition'`;
    return rows.map((r) => r.document as StoredCompetition);
  }
  async function getCompetition(id: string): Promise<StoredCompetition> {
    const rows =
      await sql()`SELECT document FROM bridge_events WHERE id=${competitionKey(id)} OR id=${id}`;
    return findCompetition(
      rows.map((r) => r.document as StoredDocument),
      id,
    );
  }
  async function insertCompetition(stored: StoredCompetition) {
    await sql()`INSERT INTO bridge_events (id,revision,document) VALUES (${competitionKey(stored.competition.id)},${stored.competition.revision},${JSON.stringify(stored)}::jsonb)`;
    return stored;
  }
  async function mutateCompetition(id: string, input: z.infer<typeof competitionUpdateSchema>) {
    const previous = await getCompetition(id),
      next = updateCompetition(previous, input);
    if (next !== previous) {
      try {
        await writeFamily(previous, next);
      } catch (e) {
        const current = await getCompetition(id);
        if (current.requests.includes(input.requestId)) return current;
        throw e;
      }
    }
    return next;
  }
  async function insertStage(parentId: string, stage: BridgeEvent, revision: number) {
    const child = { ...stage, parentEventId: parentId, stageName: stage.name };
    delete child.competition;
    const stored = { event: child, projection: project(child), requests: [] };
    const previous = await getCompetition(parentId);
    await writeFamily(previous, advanceCompetition(previous, revision, '新增賽段'), stored);
    return stored;
  }
  async function writeFamily(
    previous: StoredCompetition,
    next: StoredCompetition,
    stage?: StoredEvent,
    removal?: { id: string; revision: number },
  ) {
    const id = next.competition.id,
      key = competitionKey(id),
      revision = previous.competition.revision;
    const rows = await sql()`WITH source AS MATERIALIZED (
    SELECT id FROM bridge_events WHERE revision=${revision} AND
      (id=${key} OR (id=${id} AND NOT EXISTS (SELECT 1 FROM bridge_events WHERE id=${key})))
    ORDER BY id FOR UPDATE
  ), target AS MATERIALIZED (
    SELECT id FROM bridge_events WHERE id=${removal?.id ?? ''} AND revision=${removal?.revision ?? 0} AND EXISTS (SELECT 1 FROM source) FOR UPDATE
  ), allowed AS (
    SELECT id FROM source WHERE
      (${!removal} OR EXISTS (SELECT 1 FROM target)) AND
      (${!stage} OR (SELECT count(*) FROM bridge_events WHERE document ? 'event' AND
        (document->'event'->>'parentEventId'=${id} OR (id=${id} AND document->'event'->>'parentEventId' IS NULL))) < 32)
  ), saved AS (
    INSERT INTO bridge_events (id,revision,document)
    SELECT ${key},${next.competition.revision},${JSON.stringify(next)}::jsonb FROM allowed
    ON CONFLICT (id) DO UPDATE SET document=EXCLUDED.document, revision=EXCLUDED.revision, updated_at=now()
      WHERE bridge_events.revision=${revision}
    RETURNING id
  ), inserted AS (
    INSERT INTO bridge_events (id,revision,document)
    SELECT ${stage?.event.id ?? ''},${stage?.event.revision ?? 1},${JSON.stringify(stage ?? {})}::jsonb
    FROM saved WHERE ${!!stage} RETURNING id
  ), migrated AS (
    UPDATE bridge_events SET revision=revision+1,
      document=jsonb_set(document,'{event,revision}',to_jsonb(revision+1)),updated_at=now()
    WHERE id=${id} AND id IN (SELECT id FROM source) AND id<>${removal?.id ?? ''}
      AND EXISTS (SELECT 1 FROM saved) RETURNING id
  ), removed AS (
    DELETE FROM bridge_events WHERE id IN (SELECT id FROM target) AND EXISTS (SELECT 1 FROM saved) RETURNING id
  ) SELECT id FROM saved`;
    if (!rows.length)
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
