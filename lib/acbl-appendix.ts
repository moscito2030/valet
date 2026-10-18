import type { AcblMovement } from './acbl-movement';

/** One-and-a-half-table Appendix Mitchell: one shared table and an EW bye.
 * Independent reference exports: MIT AM090824.MOV and AM100927.MOV.
 */
export function buildAcblAppendix(tables: number): AcblMovement {
  if (!Number.isInteger(tables) || tables < 4 || tables > 39)
    throw new Error('Appendix 桌數不適用');
  const rounds = tables - 1;
  const rows = Array.from({ length: rounds }, (_, round) =>
    Array.from({ length: tables }, (_, table) => {
      const skip = rounds % 2 === 0 && round >= rounds / 2 ? 1 : 0;
      return [
        table + 1,
        tables + ((table - round - skip + 2 * (tables + 1)) % (tables + 1)) + 1,
        ((table + round) % rounds) + 1,
      ];
    }),
  );
  return {
    name: `APPENDIX${tables}`,
    tables,
    rounds,
    oneWinner: false,
    pairCount: tables * 2 + 1,
    nsCount: tables,
    groups: rounds,
    rows,
  };
}
