import { eventIndex, type EventIndex } from './event-index';
import { normalizeResults } from './result-status';
import 'server-only';
import { neon } from '@neondatabase/serverless';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyMutation, DomainError, seedEvents } from './events';
import { BridgeEvent, Mutation, StoredEvent } from './model';
import { project } from './scoring';
import { inheritCompetition } from './competitions';
import { deletionTargets, type CompetitionDeletion } from './competition-deletion';
import { advanceCompetition, competitionKey, documentKey, findCompetition, isStage, saveCompetitionRecord, stageCompetitionId, updateCompetition, type StoredCompetition, type StoredDocument, competitionUpdateSchema } from './competition-record';
import type { z } from 'zod';
export function storageMode() {
  const mode = process.env.STORAGE_MODE ?? (process.env.DATABASE_URL ? 'neon' : 'demo');
  if (mode === 'local' && process.env.VERCEL) throw new Error('Vercel 不支援 local 儲存模式');
  if (!['local', 'neon', 'demo'].includes(mode)) throw new Error('Invalid STORAGE_MODE');
  return mode;
}
const file = path.join(process.env.VALET_LOCAL_DATA_DIR ?? path.join(process.cwd(), '.data'), 'events.json');
let queue = Promise.resolve();
async function localLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
async function localRead(): Promise<StoredDocument[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return seedEvents();
    throw e;
  }
}
async function localSave(data: StoredDocument[]) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + '.tmp', JSON.stringify(data), 'utf8');
  await rename(file + '.tmp', file);
}
function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 尚未設定');
  return neon(process.env.DATABASE_URL);
}
export async function listEvents(): Promise<StoredEvent[]> {
  if (storageMode() === 'demo') return seedEvents();
  if (storageMode() === 'local') return (await localRead()).filter(isStage);
  const rows = await sql()`SELECT document FROM bridge_events WHERE document ? 'event' ORDER BY updated_at DESC`;
  return rows.map((r) => r.document as StoredEvent);
}
export async function listEventIndex(): Promise<EventIndex[]> {
  if (storageMode() !== 'neon') return (await listEvents()).map(eventIndex);
  const rows = await sql()`SELECT jsonb_build_object('id', document->'event'->'id','name', document->'event'->'name','prefix', document->'event'->'prefix','updatedAt', document->'event'->'updatedAt','kind', document->'event'->'kind','gameMode', document->'event'->'gameMode','pairMethod', document->'event'->'pairMethod','date', document->'event'->'date','endDate', document->'event'->'endDate','venue', document->'event'->'venue','venueOverride', document->'event'->'venueOverride','status', document->'event'->'status','demo', document->'event'->'demo','rounds', document->'event'->'rounds','parentEventId', document->'event'->'parentEventId','stageName', document->'event'->'stageName','hasStages', document->'event'->'hasStages','revision', document->'event'->'revision', 'participants', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p->'id')) FROM jsonb_array_elements(document->'event'->'participants') p), '[]'::jsonb), 'boards', COALESCE((SELECT jsonb_agg(jsonb_build_object('number', b->'number')) FROM jsonb_array_elements(document->'event'->'boards') b), '[]'::jsonb)) AS event, jsonb_build_object('received', document->'projection'->'received', 'expected', document->'projection'->'expected') AS projection FROM bridge_events WHERE document ? 'event' ORDER BY updated_at DESC`;
  return rows.map(r => ({ event: r.event, projection: r.projection }));
}
async function getRawEvent(id: string): Promise<StoredEvent> {
  if (storageMode() !== 'neon') {
    const e = (await listEvents()).find((x) => x.event.id === id);
    if (!e) throw new DomainError('找不到賽事', 404);
    return e;
  }
  const rows = await sql()`SELECT document FROM bridge_events WHERE id=${id} AND document ? 'event'`;
  if (!rows.length) throw new DomainError('找不到賽事', 404);
  return rows[0].document as StoredEvent;
}
export async function getEvent(id: string): Promise<StoredEvent> {
  const stored = await getRawEvent(id);
  const root = await getCompetition(stageCompetitionId(stored.event));
  const inherited = inheritCompetition(stored, root.competition);
  const event = { ...inherited.event, results: normalizeResults(inherited.event.results) };
  const legacy = Object.values(inherited.event.results).some(r => r.status === 'average');
  return { ...inherited, event, projection: legacy ? project(event) : stored.projection };
}
export async function deleteEvent(id: string, revision: number) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法刪除賽段。', 503);
  if (storageMode() === 'local') return localLock(async () => {
    const data = await localRead(), stage = data.filter(isStage).find(s => s.event.id === id);
    if (!stage) throw new DomainError('找不到賽段', 404);
    if (stage.event.revision !== revision) throw new DomainError('賽段已更新，請重新載入', 409);
    const previous = findCompetition(data, stageCompetitionId(stage.event));
    const next = advanceCompetition(previous, previous.competition.revision, '刪除賽段');
    await localSave(saveCompetitionRecord(data.filter(d => documentKey(d) !== id), next));
  });
  const stage = await getRawEvent(id);
  if (stage.event.revision !== revision) throw new DomainError('賽段已更新，請重新載入', 409);
  const previous = await getCompetition(stageCompetitionId(stage.event));
  await writeFamily(previous, advanceCompetition(previous, previous.competition.revision, '刪除賽段'), undefined, { id, revision });
}
export async function deleteCompetitions(input: CompetitionDeletion) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法刪除賽事。', 503);
  if (storageMode() === 'local') return localLock(async () => {
    const data = await localRead();
    const targets = deletionTargets(data, input);
    const ids = new Set(targets.map(t => t.id));
    await localSave(data.filter(s => !ids.has(documentKey(s))));
    return input.competitions.length;
  });
  const targets = deletionTargets([...(await listEvents()), ...(await listCompetitionRecords())], input);
  const roots = input.competitions.map(c => c.id);
  // Lock the complete families and recheck every revision before a single atomic delete.
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
  if (rows.length !== targets.length) throw new DomainError('賽事已更新，請重新載入清單後再刪除', 409);
  return input.competitions.length;
}
export async function insertEvent(event: BridgeEvent) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法儲存，請先設定資料庫。', 503);
  const stored = { event, projection: project(event), requests: [] };
  const metadata = findCompetition([stored], event.id);
  if (storageMode() === 'local')
    return localLock(async () => {
      const data = await localRead();
      if (new Set(data.map(d => isStage(d) ? stageCompetitionId(d.event) : d.competition.id)).size >= 50) throw new DomainError('最多 50 場賽事');
      data.push(metadata, stored);
      await localSave(data);
      return stored;
    });
  await sql()`INSERT INTO bridge_events (id,revision,document) VALUES (${event.id},${event.revision},${JSON.stringify(stored)}::jsonb), (${competitionKey(event.id)},${metadata.competition.revision},${JSON.stringify(metadata)}::jsonb)`;
  return stored;
}
export async function mutateEvent(id: string, command: Mutation): Promise<StoredEvent> {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法儲存，請先設定資料庫。', 503);
  if (command.action === 'competition-settings') {
    await mutateCompetition(id, { name: command.name, prefix: command.prefix, venue: command.venue, revision: command.revision, requestId: command.requestId });
    return getEvent(id);
  }
  if (storageMode() === 'local')
    return localLock(async () => {
      const data = await localRead();
      const index = data.findIndex((x) => isStage(x) && x.event.id === id);
      if (index < 0) throw new DomainError('找不到賽事', 404);
      data[index] = applyMutation(data[index] as StoredEvent, command);
      await localSave(data);
      return data[index] as StoredEvent;
    });
  const previous = await getRawEvent(id),
    next = applyMutation(previous, command);
  if (next === previous) return previous;
  // One conditional SQL statement atomically commits raw results, audit and derived snapshot.
  const rows =
    await sql()`UPDATE bridge_events SET document=${JSON.stringify(next)}::jsonb,revision=${next.event.revision},updated_at=now() WHERE id=${id} AND revision=${command.revision} RETURNING id`;
  if (!rows.length) {
    const current = await getEvent(id);
    if (current.requests.includes(command.requestId)) return current;
    throw new DomainError('另一個操作已更新成績，請重新載入。', 409);
  }
  return next;
}

export async function listCompetitionRecords(): Promise<StoredCompetition[]> {
  if (storageMode() === 'demo') return [];
  if (storageMode() === 'local') return (await localRead()).filter((d): d is StoredCompetition => !isStage(d));
  const rows = await sql()`SELECT document FROM bridge_events WHERE document ? 'competition'`;
  return rows.map(r => r.document as StoredCompetition);
}
export async function getCompetition(id: string): Promise<StoredCompetition> {
  if (storageMode() !== 'neon') return findCompetition(storageMode() === 'demo' ? seedEvents() : await localRead(), id);
  const rows = await sql()`SELECT document FROM bridge_events WHERE id=${competitionKey(id)} OR id=${id}`;
  return findCompetition(rows.map(r => r.document as StoredDocument), id);
}
export async function insertCompetition(stored: StoredCompetition) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法儲存，請先設定資料庫。', 503);
  if (storageMode() === 'local') return localLock(async () => {
    const data = await localRead();
    if (new Set(data.map(d => isStage(d) ? stageCompetitionId(d.event) : d.competition.id)).size >= 50) throw new DomainError('最多 50 場賽事');
    data.push(stored); await localSave(data); return stored;
  });
  await sql()`INSERT INTO bridge_events (id,revision,document) VALUES (${competitionKey(stored.competition.id)},${stored.competition.revision},${JSON.stringify(stored)}::jsonb)`;
  return stored;
}

// One statement serializes all family changes on the independent metadata row.
// For the first write of a legacy competition, lock its original stage instead.
async function writeFamily(previous: StoredCompetition, next: StoredCompetition, stage?: StoredEvent, removal?: { id: string; revision: number }) {
  const id = next.competition.id, key = competitionKey(id), revision = previous.competition.revision;
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
  if (!rows.length) throw new DomainError('賽事或賽段已更新，或已達 32 個賽段上限，請重新載入', 409);
}

export async function mutateCompetition(id: string, input: z.infer<typeof competitionUpdateSchema>) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法修改賽事', 503);
  if (storageMode() === 'local') return localLock(async () => {
    const data = await localRead(), previous = findCompetition(data, id), next = updateCompetition(previous, input);
    if (next !== previous) await localSave(saveCompetitionRecord(data, next));
    return next;
  });
  const previous = await getCompetition(id), next = updateCompetition(previous, input);
  if (next !== previous) {
    try { await writeFamily(previous, next); }
    catch (e) { const current = await getCompetition(id); if (current.requests.includes(input.requestId)) return current; throw e; }
  }
  return next;
}
export async function insertStage(parentId: string, stage: BridgeEvent, revision: number) {
  if (storageMode() === 'demo') throw new DomainError('展示模式無法新增賽段', 503);
  const child = { ...stage, parentEventId: parentId, stageName: stage.name };
  delete child.competition;
  const stored = { event: child, projection: project(child), requests: [] };
  if (storageMode() === 'local') return localLock(async () => {
    const data = await localRead(), previous = findCompetition(data, parentId);
    if (data.filter(isStage).filter(s => stageCompetitionId(s.event) === parentId).length >= 32) throw new DomainError('每場最多 32 個賽段');
    const next = advanceCompetition(previous, revision, '新增賽段');
    await localSave([...saveCompetitionRecord(data, next), stored]);
    return stored;
  });
  const previous = await getCompetition(parentId);
  await writeFamily(previous, advanceCompetition(previous, revision, '新增賽段'), stored);
  return stored;
}
