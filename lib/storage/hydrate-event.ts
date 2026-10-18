import { inheritCompetition } from '../competitions';
import type { CompetitionInfo, StoredEvent } from '../model';
import { normalizeResults } from '../result-status';
import { project } from '../scoring';

// Shared compatibility read: never persist inherited metadata or normalized legacy results here.
export function hydrateEvent(stored: StoredEvent, competition: CompetitionInfo): StoredEvent {
  const inherited = inheritCompetition(stored, competition);
  const event = { ...inherited.event, results: normalizeResults(inherited.event.results) };
  const legacy = Object.values(inherited.event.results).some((r) => r.status === 'average');
  return { ...inherited, event, projection: legacy ? project(event) : stored.projection };
}
