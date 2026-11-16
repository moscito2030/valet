import { DomainError } from './domain-error';
import { resultKey, type BridgeEvent, type ResultInput } from './model';

export function resultUpdatedAt(
  event: Pick<BridgeEvent, 'results'>,
  result?: Pick<ResultInput, 'assignmentId' | 'board'>,
) {
  if (!result) return undefined;
  return event.results[resultKey(result.assignmentId, result.board)]?.updatedAt ?? '';
}

// A phone retry may repeat a score only when that cell is still the version the phone edited.
// Another table's write can move the stage revision without changing this cell.
export function staleClubResult(current: string | undefined, base: string | undefined) {
  return base !== undefined && current !== undefined && current !== base;
}

export function isStageRevisionConflict(error: unknown) {
  return error instanceof DomainError && error.status === 409 && error.code === 'stage-revision';
}
