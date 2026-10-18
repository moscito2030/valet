import type { AcblMovement } from './acbl-movement';

/** Decode the numerical route records in ACBLscore 8.33 HOWELL.LBR. */
export function decodeAcblHowell(name: string, text: string): AcblMovement {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim());
  const numbers = (line: string) => line.split(/\s+/).map(Number);
  const [tables, , rounds] = numbers(lines[0]);
  const route = [...lines[1].matchAll(/(\d+)([NE])/g)].map((match) => [
    Number(match[1]) - 1,
    match[2] === 'N' ? 0 : 1,
  ]);
  const opponents = numbers(lines[2]);
  const combined = route.length === rounds * 2;
  if (route.length !== rounds && !combined) throw new Error('Invalid Howell route');
  const stationaryTables = numbers(lines[3]);
  const boardGroups = numbers(lines.at(-1)!);
  const initial = Array.from({ length: tables }, () => [0, 0]);
  const base = (pair: number) => (combined && pair > tables ? tables : 0);
  const stationary = (pair: number) => pair - base(pair) > rounds;
  const shift = (pair: number, offset: number) =>
    stationary(pair)
      ? pair
      : base(pair) + ((((pair - base(pair) - 1 + offset) % rounds) + rounds) % rounds) + 1;
  route.forEach(([table, side], index) => {
    const round = index % rounds;
    initial[table][side] = shift((index >= rounds ? tables : 0) + 1, -round);
    initial[table][1 - side] = shift(opponents[index], -round);
  });
  const rows = Array.from({ length: rounds }, (_, round) =>
    initial.map(([n, e], table) => {
      let ns = shift(n, round),
        ew = shift(e, round);
      const maskIndex = stationaryTables.indexOf(table + 1);
      if (maskIndex >= 0) {
        const side = lines[5 + maskIndex][round];
        if ((stationary(ns) && side === 'E') || (stationary(ew) && side === 'N'))
          [ns, ew] = [ew, ns];
      }
      return [ns, ew, ((boardGroups[table] - 1 + round) % rounds) + 1];
    }),
  );
  // The standard and alternate three-table full Howell have irregular board
  // movement, including a shared final round. Pinned against the exported MOV.
  if (tables === 3 && rounds === 5) {
    const groups = [
      [1, 2, 4],
      [2, 3, 4],
      [3, 2, 1],
      [4, 3, 1],
      [5, 5, 5],
    ];
    rows.forEach((row, round) => row.forEach((cell, table) => (cell[2] = groups[round][table])));
  }
  return {
    name,
    tables,
    rounds,
    oneWinner: true,
    pairCount: tables * 2,
    nsCount: 0,
    groups: rounds,
    rows,
  };
}
