import { Board, seats, Vulnerability } from '../model';
const vulCycle: Vulnerability[] = [
  'None',
  'NS',
  'EW',
  'All',
  'NS',
  'EW',
  'All',
  'None',
  'EW',
  'All',
  'None',
  'NS',
  'All',
  'None',
  'NS',
  'EW',
];
export function makeBoard(number: number): Board {
  const deck = ['S', 'H', 'D', 'C'].flatMap((s) => 'AKQJT98765432'.split('').map((r) => s + r));
  let seed = number * 7919 + 41;
  for (let i = 51; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    number,
    dealer: seats[(number - 1) % 4],
    vulnerability: vulCycle[(number - 1) % 16],
    deal: Object.fromEntries(
      seats.map((s, i) => [s, deck.slice(i * 13, i * 13 + 13)]),
    ) as Board['deal'],
  };
}
