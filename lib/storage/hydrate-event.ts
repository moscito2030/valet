import { inheritCompetition } from '../competitions';
import type { CompetitionInfo, StoredEvent } from '../model';
import { normalizeResults } from '../result-status';
import { project } from '../scoring';

// Shared compatibility read: never persist inherited metadata or normalized legacy results here.
export function hydrateEvent(stored: StoredEvent, competition: CompetitionInfo): StoredEvent {
  const inherited = inheritCompetition(stored, competition);
  const event = { ...inherited.event, results: normalizeResults(inherited.event.results) };
  const legacy = Object.values(inherited.event.results).some((r) => r.status === 'average');
  const projection = legacy ? project(event) : stored.projection;
  // Persisted projections may predate numeric tie ordering. Normalize on read,
  // without recalculating scores or writing a new event revision.
  const standings = [...projection.standings].sort((a, b) =>
    (a.group === 'EW' ? 1 : 0) - (b.group === 'EW' ? 1 : 0) ||
    a.rank - b.rank || a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
  return { ...inherited, event, projection: { ...projection, standings } };
}
