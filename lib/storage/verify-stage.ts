import type { StoredEvent } from '../model';
import { project } from '../scoring';
import { canonical } from './cell-write';

export class VerifyMismatch extends Error {
  constructor(id: string, fields: string[]) {
    super(`verify failed ${id}: ${fields.join(',')}`);
    this.name = 'VerifyMismatch';
  }
}

function same(left: unknown, right: unknown) {
  return canonical(left) === canonical(right);
}

// Compares the fields the live scoreboard depends on. Deal JSON is the exact
// JSON.stringify of each deal, in board order, so a reorder or a rewritten hand fails.
export function verifyStage(legacy: StoredEvent, loaded: StoredEvent) {
  const fields: string[] = [];
  const leftBoards = legacy.event.boards;
  const rightBoards = loaded.event.boards;
  if (leftBoards.length !== rightBoards.length) fields.push('deals');
  else {
    for (let index = 0; index < leftBoards.length; index++) {
      const left = leftBoards[index];
      const right = rightBoards[index];
      if (left.number !== right.number || JSON.stringify(left.deal) !== JSON.stringify(right.deal))
        fields.push('deals');
      const { deal: leftDeal, ...leftRest } = left;
      const { deal: rightDeal, ...rightRest } = right;
      void leftDeal;
      void rightDeal;
      if (!same(leftRest, rightRest)) fields.push('boards');
    }
  }
  if (!same(legacy.event.results, loaded.event.results)) fields.push('results');
  if (!same(legacy.event.participants, loaded.event.participants)) fields.push('participants');
  if (!same(legacy.event.penalties ?? {}, loaded.event.penalties ?? {})) fields.push('penalties');
  if (legacy.event.audit.length !== loaded.event.audit.length || !same(legacy.event.audit, loaded.event.audit))
    fields.push('audit');
  if (!same(legacy.event.assignments, loaded.event.assignments)) fields.push('assignments');
  if (!same(legacy.projection.standings, loaded.projection.standings)) fields.push('standings');
  if (!same(project(legacy.event).standings, project(loaded.event).standings)) fields.push('standings');
  if (!same([...legacy.requests].sort(), [...loaded.requests].sort())) fields.push('requests');
  const unique = [...new Set(fields)];
  if (unique.length) throw new VerifyMismatch(legacy.event.id, unique);
}
