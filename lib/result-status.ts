import type { Result } from './model';
export function isCancelled(result?: Pick<Result, 'status'>) {
  return result?.status === 'cancelled' || result?.status === 'average';
}
export function teamBoardReceived(open: Pick<Result, 'status'> | undefined, closed: Pick<Result, 'status'> | undefined, pending: boolean) {
  return !!(open && closed) || (!pending && (isCancelled(open) || isCancelled(closed)));
}

export function normalizeResults(results: Record<string, Result>) {
  return Object.fromEntries(
    Object.entries(results).map(([key, result]) => [
      key,
      result.status === 'average' ? { ...result, status: 'cancelled' as const } : result,
    ]),
  );
}


export function isPlayed(result?: Result): result is Result {
  return !!result && !isCancelled(result) && result.status !== 'adjusted';
}
