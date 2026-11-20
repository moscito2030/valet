import { DomainError } from '../domain-error';
import type { BridgeEvent, Mutation, Result, StoredEvent } from '../model';
import { resultKey } from '../model';
import { applyMutation } from '../mutations/apply';
import { accessError } from '../access/codes';
import { recordAudit, type AccessAudit } from '../access/audit';
import type { AccessCode } from '../access/codes';

export function agentError(error: unknown) {
  if (error instanceof DomainError) {
    const code = error.code === 'stage-revision' ? accessError.revisionConflict : error.code ?? accessError.forbiddenRole;
    return { message: error.message, code, status: error.status };
  }
  return { message: '無法完成', code: accessError.forbiddenRole, status: 400 };
}

export function eventStatus(event: BridgeEvent) {
  const round = event.currentRound ?? 0;
  const pending = event.assignments.filter(
    (assignment) => assignment.round === round && assignment.boards.some((board) => !event.results[resultKey(assignment.id, board)]),
  );
  return {
    currentRound: round,
    phase: event.roundPhase ?? 'playing',
    tablesPending: pending.map((assignment) => ({ assignmentId: assignment.id, round: assignment.round })),
    publishedBoards: event.boards
      .filter((board) => (board.published ?? (event as { publishBoards?: boolean }).publishBoards) === true)
      .map((board) => board.number),
  };
}

function resultChanges(before: Record<string, Result>, after: Record<string, Result>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => ({ target: key, before: before[key] ?? null, after: after[key] ?? null }));
}

export function previewMutation(stored: StoredEvent, command: Mutation) {
  if (stored.requests.includes(command.requestId)) return { alreadyApplied: true, changes: [] as { target: string; before: Result | null; after: Result | null }[] };
  const next = applyMutation(structuredClone(stored), command);
  return { alreadyApplied: false, changes: resultChanges(stored.event.results, next.event.results) };
}

export function applyIdempotent<T>(store: Map<string, T>, key: string, run: () => T) {
  const previous = store.get(key);
  if (previous) return { replayed: true, value: previous };
  const value = run();
  store.set(key, value);
  return { replayed: false, value };
}

export function auditAgentChange(actor: AccessCode, at: string, target: string, before: unknown, after: unknown): AccessAudit {
  return recordAudit(actor, { at, action: '代理操作', target, before, after, viaAgent: true, eventId: actor.eventId });
}
