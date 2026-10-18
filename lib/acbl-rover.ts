import type { AcblMovement } from './acbl-movement';

/** Numerical bump route, skip and relay settings from ACBLscore ROVER.LBR. */
export function decodeAcblRover(
  name: string,
  text: string,
  side: 'NS' | 'EW' = 'NS',
): AcblMovement {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map(Number));
  const [tables, rounds, skipAfter, byeStand, exchanges] = lines[0];
  const rows = Array.from({ length: rounds }, (_, round) =>
    Array.from({ length: tables }, (_, table) => {
      let ew =
        ((((table - round - (skipAfter && round >= skipAfter ? 1 : 0)) % tables) + tables) %
          tables) +
        1;
      // The nine-table full movement swaps two EW routes on specific rounds.
      for (let i = 0; i < exchanges; i++) {
        if (ew === lines[2 + i][0]) {
          ew = lines[2 + i][round + 1];
          break;
        }
      }
      const bumped = lines[1][round] === table + 1;
      const ns = side === 'NS' && bumped ? tables + 1 : table + 1;
      const group = ((table + round + (byeStand && table >= byeStand ? 1 : 0)) % tables) + 1;
      return [
        ns,
        (side === 'NS' ? tables + 1 : tables) + (side === 'EW' && bumped ? tables + 1 : ew),
        group,
      ];
    }),
  );
  return {
    name,
    tables,
    rounds,
    oneWinner: false,
    pairCount: tables * 2 + 1,
    nsCount: tables + (side === 'NS' ? 1 : 0),
    groups: tables,
    rows,
  };
}
