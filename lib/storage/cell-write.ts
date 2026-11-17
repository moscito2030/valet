import { DomainError } from '../domain-error';
import { resultKey, type BridgeEvent, type Mutation, type StoredEvent } from '../model';
import { applyMutation } from '../mutations/apply';

export type ResultWrites = Record<string, number>;

// Null means the command still uses the stage revision. An array means only those
// table+board cells decide the conflict. Other tables can commit in between.
export function cellsForCommand(event: BridgeEvent, command: Mutation): string[] | null {
  switch (command.action) {
    case 'results':
      return command.results.map((result) => resultKey(result.assignmentId, result.board));
    case 'clear-result':
    case 'ruling':
    case 'split-contract':
      return [resultKey(command.assignmentId, command.board)];
    case 'club-play':
      return command.result ? [resultKey(command.result.assignmentId, command.result.board)] : null;
    case 'club-complete-table': {
      const assignment = event.assignments.find(
        (item) => item.id === command.assignmentId && item.round === command.round,
      );
      return assignment ? assignment.boards.map((board) => resultKey(assignment.id, board)) : [];
    }
    default:
      return null;
  }
}

export function seedResultWrites(event: BridgeEvent, writes?: ResultWrites): ResultWrites {
  if (writes) return writes;
  const seeded: ResultWrites = {};
  for (const key of Object.keys(event.results)) seeded[key] = event.revision;
  return seeded;
}

export function trackResultWrites(
  before: StoredEvent,
  after: StoredEvent,
  writes: ResultWrites,
): ResultWrites {
  const next = { ...writes };
  const keys = new Set([
    ...Object.keys(before.event.results),
    ...Object.keys(after.event.results),
  ]);
  for (const key of keys) {
    if (canonical(before.event.results[key]) === canonical(after.event.results[key])) continue;
    if (after.event.results[key]) next[key] = after.event.revision;
    else delete next[key];
  }
  return next;
}

export function commitDocumentMutation(
  stored: StoredEvent,
  command: Mutation,
  writes?: ResultWrites,
): { stored: StoredEvent; writes: ResultWrites } {
  const known = seedResultWrites(stored.event, writes);
  if (stored.requests.includes(command.requestId)) return { stored, writes: known };
  const cells = cellsForCommand(stored.event, command);
  if (cells) {
    const stale = cells.some((key) => {
      const writtenAt = known[key] ?? (stored.event.results[key] ? stored.event.revision : 0);
      return writtenAt > command.revision;
    });
    if (stale)
      throw new DomainError('賽段版本已更新，請重新載入後再提交。', 409, 'stage-revision');
    const revision = stored.event.revision;
    const next = applyMutation(
      stored,
      command.revision === revision ? command : { ...command, revision },
    );
    return { stored: next, writes: trackResultWrites(stored, next, known) };
  }
  const next = applyMutation(stored, command);
  return { stored: next, writes: trackResultWrites(stored, next, known) };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
