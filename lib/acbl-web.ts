import type { AcblMovement } from './acbl-movement';

/** Original Web: two equally sized board streams, even tables and odd rounds.
 * Reference: Tim Hill, Web movements, 18-table / 13-round worked table.
 * Larger fields split into even blocks; pinned to the bundled 28–36-table MOVs.
 */
export function buildAcblWeb(tables: number, rounds: number): AcblMovement {
  if (
    !Number.isInteger(tables) ||
    !Number.isInteger(rounds) ||
    tables < 4 ||
    tables > 40 ||
    tables % 2 ||
    rounds < 3 ||
    !(rounds % 2) ||
    rounds >= tables
  )
    throw new Error('Web 須為偶數桌、奇數圈，桌數大於圈數');
  const split = (count: number): number[] => {
    if (count <= rounds * 2) return [count];
    const first = 2 * Math.ceil(count / 4);
    return [...split(first), ...split(count - first)];
  };
  const streams = split(tables).flatMap((count) =>
    Array.from({ length: count }, (_, table) =>
      table < count / 2 ? [table, 1] : [count - table - 2, -1],
    ),
  );
  const rows = Array.from({ length: rounds }, (_, round) =>
    Array.from({ length: tables }, (_, table) => {
      const [start, direction] = streams[table];
      const group = ((((start + direction * round) % rounds) + rounds) % rounds) + 1;
      return [table + 1, tables + ((table - round + tables) % tables) + 1, group];
    }),
  );
  return {
    name: `WEB${tables}-${rounds}`,
    tables,
    rounds,
    oneWinner: false,
    pairCount: tables * 2,
    nsCount: tables,
    groups: rounds,
    rows,
  };
}
