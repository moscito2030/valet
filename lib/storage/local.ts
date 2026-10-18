import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import { deletionTargets, type CompetitionDeletion } from '../competition-deletion';
import {
  advanceCompetition,
  competitionUpdateSchema,
  documentKey,
  findCompetition,
  isStage,
  saveCompetitionRecord,
  stageCompetitionId,
  updateCompetition,
  type StoredCompetition,
  type StoredDocument,
} from '../competition-record';
import { DomainError } from '../domain-error';
import { seedEvents } from '../domain/demo-events';
import { eventIndex, type EventIndex } from '../event-index';
import { BridgeEvent, Mutation, StoredEvent } from '../model';
import { applyMutation } from '../mutations/apply';
import { project } from '../scoring';
import { hydrateEvent } from './hydrate-event';
import type { EventRepository } from './repository';

export function createLocalRepository(directory: string): EventRepository {
  const file = path.join(directory, 'events.json');
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
  async function getRawEvent(id: string): Promise<StoredEvent> {
    const e = (await listEvents()).find((x) => x.event.id === id);
    if (!e) throw new DomainError('找不到賽事', 404);
    return e;
  }
  async function listEvents(): Promise<StoredEvent[]> {
    return (await localRead()).filter(isStage);
  }
  async function listEventIndex(): Promise<EventIndex[]> {
    return (await listEvents()).map(eventIndex);
  }
  async function getEvent(id: string): Promise<StoredEvent> {
    const stored = await getRawEvent(id);
    const root = await getCompetition(stageCompetitionId(stored.event));
    return hydrateEvent(stored, root.competition);
  }
  async function deleteEvent(id: string, revision: number) {
    return localLock(async () => {
      const data = await localRead(),
        stage = data.filter(isStage).find((s) => s.event.id === id);
      if (!stage) throw new DomainError('找不到賽段', 404);
      if (stage.event.revision !== revision) throw new DomainError('賽段已更新，請重新載入', 409);
      const previous = findCompetition(data, stageCompetitionId(stage.event));
      const next = advanceCompetition(previous, previous.competition.revision, '刪除賽段');
      await localSave(
        saveCompetitionRecord(
          data.filter((d) => documentKey(d) !== id),
          next,
        ),
      );
    });
  }
  async function deleteCompetitions(input: CompetitionDeletion) {
    return localLock(async () => {
      const data = await localRead();
      const targets = deletionTargets(data, input);
      const ids = new Set(targets.map((t) => t.id));
      await localSave(data.filter((s) => !ids.has(documentKey(s))));
      return input.competitions.length;
    });
  }
  async function insertEvent(event: BridgeEvent) {
    const stored = { event, projection: project(event), requests: [] };
    const metadata = findCompetition([stored], event.id);
    return localLock(async () => {
      const data = await localRead();
      if (
        new Set(data.map((d) => (isStage(d) ? stageCompetitionId(d.event) : d.competition.id)))
          .size >= 50
      )
        throw new DomainError('最多 50 場賽事');
      data.push(metadata, stored);
      await localSave(data);
      return stored;
    });
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
    return localLock(async () => {
      const data = await localRead();
      const index = data.findIndex((x) => isStage(x) && x.event.id === id);
      if (index < 0) throw new DomainError('找不到賽事', 404);
      data[index] = applyMutation(data[index] as StoredEvent, command);
      await localSave(data);
      return data[index] as StoredEvent;
    });
  }
  async function listCompetitionRecords(): Promise<StoredCompetition[]> {
    return (await localRead()).filter((d): d is StoredCompetition => !isStage(d));
  }
  async function getCompetition(id: string): Promise<StoredCompetition> {
    return findCompetition(await localRead(), id);
  }
  async function insertCompetition(stored: StoredCompetition) {
    return localLock(async () => {
      const data = await localRead();
      if (
        new Set(data.map((d) => (isStage(d) ? stageCompetitionId(d.event) : d.competition.id)))
          .size >= 50
      )
        throw new DomainError('最多 50 場賽事');
      data.push(stored);
      await localSave(data);
      return stored;
    });
  }
  async function mutateCompetition(id: string, input: z.infer<typeof competitionUpdateSchema>) {
    return localLock(async () => {
      const data = await localRead(),
        previous = findCompetition(data, id),
        next = updateCompetition(previous, input);
      if (next !== previous) await localSave(saveCompetitionRecord(data, next));
      return next;
    });
  }
  async function insertStage(parentId: string, stage: BridgeEvent, revision: number) {
    const child = { ...stage, parentEventId: parentId, stageName: stage.name };
    delete child.competition;
    const stored = { event: child, projection: project(child), requests: [] };
    return localLock(async () => {
      const data = await localRead(),
        previous = findCompetition(data, parentId);
      if (data.filter(isStage).filter((s) => stageCompetitionId(s.event) === parentId).length >= 32)
        throw new DomainError('每場最多 32 個賽段');
      const next = advanceCompetition(previous, revision, '新增賽段');
      await localSave([...saveCompetitionRecord(data, next), stored]);
      return stored;
    });
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
