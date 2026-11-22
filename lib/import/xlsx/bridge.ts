import type { Board, ResultInput, Seat, Vulnerability } from '../../model';
import { seats } from '../../model';
import type { Sheet } from './workbook';

const pass = { level: 0, strain: 'NT', doubled: 1, declarer: 'N', tricks: 0, lead: '' } as const;

export function parseContract(text: string) {
  if (text === 'P') return { ...pass, status: 'played' as const, style: 'P' };
  if (text === 'A') return { ...pass, status: 'average' as const, style: 'A' };
  const match = /^([1-7])([CDHSN])(XX|X)?([NESW])(-?\d+)$/.exec(text);
  if (!match) return undefined;
  const [, levelText, strain, double, declarer, result] = match;
  const level = Number(levelText);
  const tricks = Number(result) + 6 + (result.startsWith('-') ? level : 0);
  if (
    tricks < 0 ||
    tricks > 13 ||
    (result.startsWith('-') && Number(result) === 0) ||
    (!result.startsWith('-') && tricks < level + 6)
  )
    return undefined;
  return {
    level,
    strain: (strain === 'N' ? 'NT' : strain) as ResultInput['strain'],
    doubled: double === 'XX' ? (4 as const) : double === 'X' ? (2 as const) : (1 as const),
    declarer: declarer as Seat,
    tricks,
    lead: '',
    status: 'played' as const,
    style: `${double ?? 'undoubled'} ${result.startsWith('-') ? 'down' : 'made'}`,
  };
}

export const cell = (sheet: Sheet, row: number, col: string) => sheet.get(row)?.get(col);
export const label = (sheet: Sheet, row: number, col: string) =>
  String(cell(sheet, row, col) ?? '').trim();
export function numeric(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}
export function column(index: number): string {
  return (
    (index >= 26 ? column(Math.floor(index / 26) - 1) : '') + String.fromCharCode(65 + (index % 26))
  );
}

export function boardMetadata(
  dealer: string,
  vulnerability: string,
): { dealer: Seat; vulnerability: Vulnerability } {
  if (!seats.includes(dealer as Seat) || !['None', 'NS', 'EW', 'Both'].includes(vulnerability)) {
    throw new Error('牌張的發牌人或身價無效');
  }
  return {
    dealer: dealer as Seat,
    vulnerability: vulnerability === 'Both' ? 'All' : (vulnerability as Vulnerability),
  };
}

export function parseDeals(sheet: Sheet) {
  const rounds = new Map<number, Map<number, Board['deal']>>();
  let round: Map<number, Board['deal']> | undefined;
  for (const [row] of [...sheet].sort(([a], [b]) => a - b)) {
    const id = numeric(cell(sheet, row, 'A'));
    if (id !== null) {
      if (!Number.isInteger(id) || id < 1 || rounds.has(id)) throw new Error('Hands 圈次無效');
      round = new Map();
      rounds.set(id, round);
    }
    for (const offset of [0, 42]) {
      if (label(sheet, row, column(offset + 1)) !== '#') continue;
      const number = numeric(cell(sheet, row, column(offset + 2)));
      if (
        !round ||
        number === null ||
        number <= 0 ||
        !Number.isInteger(number) ||
        round.has(number)
      ) {
        throw new Error(`Hands 第 ${row} 列牌號無效`);
      }
      const deal: Board['deal'] = { N: [], E: [], S: [], W: [] };
      const positions = [
        ['N', 3, 0],
        ['E', 11, 4],
        ['S', 3, 8],
        ['W', 1, 4],
      ] as const;
      for (const [seat, col, delta] of positions) {
        for (const [index, suit] of [...'SHDC'].entries()) {
          const rankRow = row + delta + index;
          const ranks = label(sheet, rankRow, column(offset + col + 1));
          if (
            label(sheet, rankRow, column(offset + col)) !== 'ª©¨§'[index] ||
            !/^[AKQJT2-9]*$/.test(ranks)
          ) {
            throw new Error(`Hands 第 ${rankRow} 列花色或牌點無效`);
          }
          deal[seat].push(...Array.from(ranks, (rank) => suit + rank));
        }
      }
      if (
        seats.some((seat) => deal[seat].length !== 13) ||
        new Set(Object.values(deal).flat()).size !== 52
      ) {
        throw new Error(`Hands 第 ${row} 列不滿足四家各 13 張且共 52 張不重複`);
      }
      round.set(number, deal);
    }
  }
  return rounds;
}
