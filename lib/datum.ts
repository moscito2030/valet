import type { Result, Trim } from './model';
import { awardedResult, trimScores } from './scoring';

export function directionalDatum(results: Result[], trim: Trim = 'none') {
  const valid = results.filter(r => r && r.status !== 'cancelled' && r.status !== 'average');
  const side = (direction: 'ns' | 'ew') => {
    const values = trimScores(valid.map(r => awardedResult(r, direction)!.nsScore * (direction === 'ns' ? 1 : -1)), trim);
    const mean = values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
    return { mean, datum: mean === null ? null : Math.sign(mean) * Math.round(Math.abs(mean) / 10) * 10 };
  };
  return { ns: side('ns'), ew: side('ew'), split: valid.some(r => !!r.split), valid: valid.length };
}
