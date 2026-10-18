import type { ClubView } from './club-view';
import type { Result } from './model';

export function collectionScoreSide(data: Pick<ClubView, 'role' | 'pair' | 'roles' | 'assignment' | 'accepted'>, reviewing: boolean): 'NS' | 'EW' {
  const pair = data.role === 'shared'
    ? reviewing || data.accepted ? data.roles?.confirmPair : data.roles?.inputPair
    : data.pair;
  return data.assignment && pair === data.assignment.ew ? 'EW' : 'NS';
}
export function collectionScoreLabel(result: Pick<Result, 'nsScore' | 'split'>, side: 'NS' | 'EW') {
  const score = side === 'NS' ? result.split?.ns.nsScore ?? result.nsScore : -(result.split?.ew.nsScore ?? result.nsScore);
  return `${side} ${score > 0 ? '+' : ''}${score}`;
}
