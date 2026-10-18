import { neon } from '@neondatabase/serverless';
import path from 'node:path';
import 'server-only';
import { createDemoRepository } from './storage/demo';
import { createLocalRepository } from './storage/local';
import { createNeonRepository } from './storage/neon';
import type { EventRepository } from './storage/repository';

export function storageMode() {
  const mode = process.env.STORAGE_MODE ?? (process.env.DATABASE_URL ? 'neon' : 'demo');
  if (mode === 'local' && process.env.VERCEL) throw new Error('Vercel 不支援 local 儲存模式');
  if (!['local', 'neon', 'demo'].includes(mode)) throw new Error('Invalid STORAGE_MODE');
  return mode;
}

const local = createLocalRepository(
  process.env.VALET_LOCAL_DATA_DIR ?? path.join(process.cwd(), '.data'),
);
const demo = createDemoRepository();
function repository(): EventRepository {
  const mode = storageMode();
  if (mode === 'local') return local;
  if (mode === 'demo') return demo;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 尚未設定');
  return createNeonRepository(neon(process.env.DATABASE_URL));
}

export const listEvents: EventRepository['listEvents'] = (...args) =>
  repository().listEvents(...args);
export const listEventIndex: EventRepository['listEventIndex'] = (...args) =>
  repository().listEventIndex(...args);
export const getEvent: EventRepository['getEvent'] = (...args) => repository().getEvent(...args);
export const deleteEvent: EventRepository['deleteEvent'] = (...args) =>
  repository().deleteEvent(...args);
export const deleteCompetitions: EventRepository['deleteCompetitions'] = (...args) =>
  repository().deleteCompetitions(...args);
export const insertEvent: EventRepository['insertEvent'] = (...args) =>
  repository().insertEvent(...args);
export const mutateEvent: EventRepository['mutateEvent'] = (...args) =>
  repository().mutateEvent(...args);
export const listCompetitionRecords: EventRepository['listCompetitionRecords'] = (...args) =>
  repository().listCompetitionRecords(...args);
export const getCompetition: EventRepository['getCompetition'] = (...args) =>
  repository().getCompetition(...args);
export const insertCompetition: EventRepository['insertCompetition'] = (...args) =>
  repository().insertCompetition(...args);
export const mutateCompetition: EventRepository['mutateCompetition'] = (...args) =>
  repository().mutateCompetition(...args);
export const insertStage: EventRepository['insertStage'] = (...args) =>
  repository().insertStage(...args);
