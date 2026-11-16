import { boardsStillInPlay } from './board-in-play';
import { BridgeEvent } from './model';
export function publicBoards(event: BridgeEvent) {
  return event.boards.map((b) => {
    const published = b.published ?? event.publishBoards;
    const summary = { number: b.number, group: b.group, dealer: b.dealer, vulnerability: b.vulnerability, published };
    return published ? { ...summary, deal: b.deal } : summary;
  });
}
export function presentBoards(event: BridgeEvent) {
  const waiting = boardsStillInPlay(event);
  return publicBoards(event).map((board) => {
    if (!waiting.has(board.number)) return board;
    const { deal, ...rest } = { ...board, deal: undefined };
    return { ...rest, published: false };
  });
}
export function boardsForRole(event: BridgeEvent, director: boolean) {
  return director ? event.boards : presentBoards(event);
}
