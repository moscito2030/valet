import { DomainError } from '../domain-error';
import { Board, BridgeEvent, ResultInput } from '../model';
import { contractScore } from '../scoring';
export function scoredInput(r: ResultInput, event: BridgeEvent, board: Board) {
  const miniBridge = event.gameMode === 'minibridge';
  try {
    if (r.hcp && !miniBridge) throw new Error('四家大牌點僅適用迷你橋牌');
    return { ...r, miniBridge, nsScore: contractScore(r, board.vulnerability, miniBridge) };
  } catch (error) {
    throw new DomainError((error as Error).message);
  }
}
