import type { Result } from './model';
export function isCancelled(result?: Result) {
  return result?.status === 'cancelled' || result?.status === 'average';
}
export function normalizeResults(results: Record<string, Result>) {
  return Object.fromEntries(
    Object.entries(results).map(([key, result]) => [
      key,
      result.status === 'average' ? { ...result, status: 'cancelled' as const } : result,
    ]),
  );
}
