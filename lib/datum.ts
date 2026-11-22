import { isPlayed } from './result-status';
import type { Result, Trim } from './model';
import { awardedResult, roundedDatum, trimScores } from './scoring';

export function directionalDatum(results: Result[], trim: Trim = 'none') {
  const valid = results.filter(r => isPlayed(r));
  const side = (direction: 'ns' | 'ew') => {
    const values = trimScores(valid.map(r => awardedResult(r, direction)!.nsScore * (direction === 'ns' ? 1 : -1)), trim);
    const mean = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
    return { mean, datum: mean === null ? null : roundedDatum(mean) };
  };
  return { ns: side('ns'), ew: side('ew'), split: valid.some(r => !!r.split), valid: valid.length };
}
