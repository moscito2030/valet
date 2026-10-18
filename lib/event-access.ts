import 'server-only';
import { getEvent } from './store';
import { isDirector } from './auth';
import { DomainError } from './domain-error';

// All stage HTTP readers share this check, including authenticated collection links.
export async function getAccessibleEvent(id: string) {
  const stored = await getEvent(id);
  if (stored.event.competition?.archived && !(await isDirector()))
    throw new DomainError('找不到賽事', 404);
  return stored;
}
