import { BridgeEvent } from './model';
export function publicBoards(event: BridgeEvent) {
  return event.boards.map((b) => {
    const published = b.published ?? event.publishBoards;
    const summary = { number: b.number, group: b.group, dealer: b.dealer, vulnerability: b.vulnerability, published };
    return published ? { ...summary, deal: b.deal } : summary;
  });
}
