import type { AcblMovement } from './acbl-movement';

// Beynon Appendix: overlapping NS and EW circuits of a prime number of tables.
// NS moves one, EW two, boards one in the opposite direction. Extra tables
// share with the corresponding base table. See docs/movement-and-dealer.md.
export const APPENDIX_BASES = [5, 7, 11, 13, 17, 19, 23, 29, 31, 37];
export function buildAppendixMitchell(tables: number, rounds: number): AcblMovement {
  if (
    !Number.isInteger(tables) ||
    tables > 40 ||
    !APPENDIX_BASES.includes(rounds) ||
    tables <= rounds ||
    tables > 2 * rounds
  )
    throw new Error('Appendix Mitchell 桌數須介於基本圈數 + 1 與兩倍基本圈數，最多 40 桌');
  const extra = tables - rounds,
    inverseTwo = (rounds + 1) / 2;
  const mod = (n: number) => ((n % rounds) + rounds) % rounds;
  // Moving pair numbers follow the two lines of the combined Howell records.
  // Reserve A_i vs B_(i+1) for an odd-table Interwoven Howell second session.
  let offset = 0;
  while (
    Array.from({ length: rounds - extra }, (_, i) =>
      mod(extra - inverseTwo * (i + extra) + offset),
    ).includes(1)
  )
    offset++;
  return {
    name: `APPENDIX-T${tables}-R${rounds}`,
    tables,
    rounds,
    oneWinner: false,
    pairCount: tables * 2,
    nsCount: tables,
    groups: rounds,
    rows: Array.from({ length: rounds }, (_, r) =>
      Array.from({ length: tables }, (_, t) => [
        t < extra ? rounds + t + 1 : mod(t - extra - r) + 1,
        tables + (t >= rounds ? t + 1 : mod(inverseTwo * (t - 2 * r) + offset) + 1),
        mod(t + r) + 1,
      ]),
    ),
  };
}

export function isInterwovenRecord(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const rounds = Number(lines[0].trim().split(/\s+/)[2]);
  return (lines[1].match(/\d+[NE]/g)?.length ?? 0) === 2 * rounds;
}
const opponentKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
export function sessionsHaveDistinctOpponents(first: AcblMovement, second: AcblMovement) {
  if (first.pairCount !== second.pairCount) return false;
  const opponents = new Set(
    first.rows
      .flat()
      .filter((c) => c !== null)
      .map((c) => opponentKey(c![0], c![1])),
  );
  return second.rows.flat().every((c) => !c || !opponents.has(opponentKey(c[0], c[1])));
}
