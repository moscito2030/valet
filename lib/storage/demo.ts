import { findCompetition } from '../competition-record';
import { inheritCompetition } from '../competitions';
import { DomainError } from '../domain-error';
import { seedEvents } from '../domain/demo-events';
import { eventIndex } from '../event-index';
import type { EventRepository } from './repository';

const unavailable = (message: string) => async (): Promise<never> => {
  throw new DomainError(message, 503);
};

export function createDemoRepository(): EventRepository {
  return {
    listEvents: async () => seedEvents(),
    listEventIndex: async () => seedEvents().map(eventIndex),
    listCompetitionRecords: async () => [],
    getCompetition: async (id) => findCompetition(seedEvents(), id),
    getEvent: async (id) => {
      const data = seedEvents(),
        stored = data.find((s) => s.event.id === id);
      if (!stored) throw new DomainError('找不到賽事', 404);
      return inheritCompetition(
        stored,
        findCompetition(data, stored.event.parentEventId ?? id).competition,
      );
    },
    deleteEvent: unavailable('展示模式無法刪除賽段。'),
    deleteCompetitions: unavailable('展示模式無法刪除賽事。'),
    insertEvent: unavailable('展示模式無法儲存，請先設定資料庫。'),
    mutateEvent: unavailable('展示模式無法儲存，請先設定資料庫。'),
    insertCompetition: unavailable('展示模式無法儲存，請先設定資料庫。'),
    mutateCompetition: unavailable('展示模式無法修改賽事'),
    insertStage: unavailable('展示模式無法新增賽段'),
  };
}
