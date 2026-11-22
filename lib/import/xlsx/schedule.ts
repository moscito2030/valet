import { cell, column, label, numeric } from './bridge';
import { type readWorkbook, type Sheet } from './workbook';

export const importFormats = ['round-robin', 'swiss', 'auto'] as const;
export type ImportFormat = (typeof importFormats)[number];
type Fixture = { opponent: number; table: number };
type SwissRow = { row: number; fixture: Fixture | null };
type SwissSummary = {
  source: 'Swiss R' | 'Swiss T';
  sheet: Sheet;
  rounds: Map<number, Map<number, SwissRow>>;
};
type ScheduleDifference = {
  source: string;
  round?: number;
  row?: number;
  team?: number;
  field: string;
  file: string | number | null;
  expected: string | number | null;
};

export class ImportScheduleError extends Error {
  constructor(
    message: string,
    readonly report: object,
  ) {
    super(message);
  }
}

const headings = ['對手', '桌次', '國際序分', '勝分', '總勝分', '名次'];
export const roundColumn = (round: number, offset = 0) => column(2 + (round - 1) * 6 + offset);
const opponentMarker = /^(?:0|輪空|Bye|[-—])$/i;
const positiveInteger = (value: number | null): value is number =>
  value !== null && Number.isSafeInteger(value) && value > 0;

function readSwiss(
  sheet: Sheet,
  source: SwissSummary['source'],
  teams: Set<number>,
  differences: ScheduleDifference[],
): SwissSummary {
  const rows = new Map<number, number>();
  for (const [row] of sheet) {
    const team = numeric(cell(sheet, row, 'A'));
    if (row < 3 || !positiveInteger(team)) continue;
    if (!teams.has(team) || rows.has(team)) {
      differences.push({
        source,
        row,
        team,
        field: 'roster',
        file: team,
        expected: 'unique Players team',
      });
    } else rows.set(team, row);
  }
  for (const team of teams) {
    if (!rows.has(team))
      differences.push({ source, team, field: 'roster', file: null, expected: team });
  }
  const rounds = new Map<number, Map<number, SwissRow>>();
  for (let round = 1; label(sheet, 1, roundColumn(round)) === `第${round}圈`; round++) {
    const opponentCol = roundColumn(round);
    const tableCol = roundColumn(round, 1);
    const populated = [...rows.values()].some((row) => {
      const opponent = label(sheet, row, opponentCol);
      return (
        positiveInteger(numeric(opponent)) ||
        !!label(sheet, row, tableCol) ||
        /^(?:輪空|bye)$/i.test(opponent)
      );
    });
    if (!populated) continue;
    if (
      round !== rounds.size + 1 ||
      headings.some((heading, index) => {
        const actual = label(sheet, 2, roundColumn(round, index));
        return actual !== heading && !(index === 5 && actual === '總名次');
      })
    ) {
      differences.push({
        source,
        round,
        field: 'round headers',
        file: null,
        expected: 'contiguous round with six standard headings',
      });
    }
    const fixtures = new Map<number, SwissRow>();
    rounds.set(round, fixtures);
    for (const [team, row] of rows) {
      const opponentLabel = label(sheet, row, opponentCol);
      const tableLabel = label(sheet, row, tableCol);
      const opponent = numeric(opponentLabel);
      const table = numeric(tableLabel);
      if (
        (!opponentLabel || opponentMarker.test(opponentLabel)) &&
        (!tableLabel || opponentMarker.test(tableLabel))
      ) {
        fixtures.set(team, { row, fixture: null });
      } else if (
        positiveInteger(opponent) &&
        teams.has(opponent) &&
        opponent !== team &&
        positiveInteger(table)
      ) {
        fixtures.set(team, { row, fixture: { opponent, table } });
      } else {
        differences.push({
          source,
          round,
          team,
          row,
          field: 'fixture',
          file: `${opponent ?? 'unknown'} @ ${table ?? 'unknown'}`,
          expected: 'valid opponent and table or bye',
        });
      }
    }
    const occupied = new Map<number, number>();
    for (const [team, { fixture }] of fixtures) {
      if (!fixture) continue;
      const reciprocal = fixtures.get(fixture.opponent)?.fixture;
      if (reciprocal?.opponent !== team || reciprocal.table !== fixture.table) {
        differences.push({
          source,
          round,
          team,
          field: 'reciprocal fixture',
          file: fixture.opponent,
          expected: 'mutual opponent at the same table',
        });
      } else if (team < fixture.opponent) {
        const prior = occupied.get(fixture.table);
        if (prior !== undefined)
          differences.push({
            source,
            round,
            team,
            field: 'table occupied twice',
            file: fixture.table,
            expected: 'one match per table',
          });
        occupied.set(fixture.table, team);
      }
    }
  }
  return { source, sheet, rounds };
}

type RoundView = { team: number; opponent: number; row: number; openNS: boolean };

export function readImportSchedule(
  workbook: ReturnType<typeof readWorkbook>,
  teams: Set<number>,
  requested: ImportFormat,
) {
  const differences: ScheduleDifference[] = [];
  const summaries = (['Swiss R', 'Swiss T'] as const)
    .filter((source) => workbook.names.includes(source))
    .map((source) => readSwiss(workbook.sheet(source), source, teams, differences));
  const [primary, secondary] = summaries;
  if (!primary?.rounds.size) {
    differences.push({
      source: primary?.source ?? 'Swiss R / Swiss T',
      field: 'rounds',
      file: 0,
      expected: 'at least one round',
    });
  }
  if (primary && secondary) {
    for (const round of new Set([...primary.rounds.keys(), ...secondary.rounds.keys()])) {
      const first = primary.rounds.get(round),
        second = secondary.rounds.get(round);
      if (!first || !second) {
        differences.push({
          source: 'Swiss T',
          round,
          field: 'round present',
          file: Number(!!second),
          expected: Number(!!first),
        });
        continue;
      }
      for (const team of teams) {
        const a = first.get(team)?.fixture,
          b = second.get(team)?.fixture;
        for (const field of ['opponent', 'table'] as const) {
          if (a?.[field] !== b?.[field]) {
            differences.push({
              source: 'Swiss T',
              round,
              team,
              field,
              file: b?.[field] ?? null,
              expected: a?.[field] ?? null,
            });
          }
        }
      }
    }
  }
  if (differences.length)
    throw new ImportScheduleError('Swiss 對陣資料不一致，停止匯入。', {
      scheduleDifferences: differences.map((difference) => ({
        ...difference,
        category: 'source-internal',
      })),
      mismatchCountByCategory: {
        'source-internal': differences.length,
        'ranking-convention': 0,
        scoring: 0,
      },
    });

  const teamIds = [...teams];
  const counts = new Map<string, number>();
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  for (const [i, team] of teamIds.entries()) {
    for (const opponent of teamIds.slice(i + 1)) counts.set(key(team, opponent), 0);
  }
  const byes: { round: number; team: number }[] = [];
  for (const [round, fixtures] of primary.rounds) {
    for (const [team, { fixture }] of fixtures) {
      if (!fixture) byes.push({ round, team });
      else if (team < fixture.opponent) {
        const pair = key(team, fixture.opponent);
        counts.set(pair, counts.get(pair)! + 1);
      }
    }
  }
  const pairFrequency: Record<number, number> = {};
  for (const count of counts.values()) pairFrequency[count] = (pairFrequency[count] ?? 0) + 1;
  const inferred =
    pairFrequency[1] === counts.size
      ? 'round-robin'
      : pairFrequency[2] === counts.size
        ? 'double-round-robin'
        : 'swiss';
  const format = {
    requested,
    inferred,
    adopted: requested === 'auto' || requested === inferred ? inferred : null,
    pairFrequency,
    hasByes: byes.length > 0,
    byes,
  };
  if (!format.adopted) {
    throw new ImportScheduleError(
      `賽制警告：--format ${requested} 與實際推斷 ${inferred} 不符，停止匯入。`,
      { format },
    );
  }
  const byeAwards = byes.map(({ round, team }) =>
    numeric(cell(primary.sheet, primary.rounds.get(round)!.get(team)!.row, roundColumn(round, 3))),
  );
  const byeVp = byeAwards[0];
  if (
    byes.length &&
    (teams.size % 2 === 0 ||
      [...primary.rounds.keys()].some(
        (round) => byes.filter((bye) => bye.round === round).length !== 1,
      ) ||
      byeVp === null ||
      byeVp < 0 ||
      byeVp > 20 ||
      byeAwards.some((value) => value !== byeVp))
  ) {
    throw new ImportScheduleError('VALET 尚不支援此工作簿的輪空安排或變動 VP，停止匯入。', {
      format: { ...format, adopted: null },
    });
  }

  const rounds = new Map<
    number,
    { source: string; sheet: Sheet; tables: Map<number, RoundView[]> }
  >();
  for (const [round, fixtures] of primary.rounds) {
    const source = `R${round}`;
    if (!workbook.names.includes(source)) {
      differences.push({ source, round, field: 'score sheet', file: null, expected: source });
      continue;
    }
    const sheet = workbook.sheet(source);
    const tables = new Map<number, RoundView[]>();
    for (const { fixture } of fixtures.values()) {
      if (fixture && !tables.has(fixture.table)) tables.set(fixture.table, []);
    }
    const seen = new Set<number>();
    for (const [row] of sheet) {
      if (label(sheet, row, 'A') !== 'NS' || label(sheet, row, 'R') !== 'Table') continue;
      const team = numeric(cell(sheet, row, 'M'));
      const opponent = numeric(cell(sheet, row, 'AD'));
      const table = numeric(cell(sheet, row, 'Y'));
      const room = /\((開O|閉C)\)$/.exec(label(sheet, row, 'C'))?.[1];
      const expected = team === null ? undefined : fixtures.get(team)?.fixture;
      if (
        !positiveInteger(team) ||
        !expected ||
        opponent !== expected.opponent ||
        table !== expected.table
      ) {
        differences.push({
          source,
          round,
          row,
          team: team ?? undefined,
          field: 'fixture',
          file: `${opponent ?? 'unknown'} @ ${table ?? 'unknown'}`,
          expected: expected ? `${expected.opponent} @ ${expected.table}` : null,
        });
        continue;
      }
      if (!room || seen.has(team) || label(sheet, row + 1, 'A') !== 'EW') {
        differences.push({
          source,
          round,
          row,
          team,
          field: 'team view',
          file: null,
          expected: 'one NS/EW score block',
        });
        continue;
      }
      seen.add(team);
      tables.get(expected.table)!.push({
        team,
        opponent: expected.opponent,
        row,
        openNS: room === '開O',
      });
    }
    for (const [team, { fixture }] of fixtures) {
      if (fixture && !seen.has(team)) {
        differences.push({
          source,
          round,
          team,
          field: 'missing team view',
          file: null,
          expected: `${fixture.opponent} @ ${fixture.table}`,
        });
      }
    }
    for (const [table, views] of tables) {
      if (views.length === 2 && views[0].openNS === views[1].openNS) {
        differences.push({
          source,
          round,
          field: 'rooms',
          file: table,
          expected: 'one open NS and one closed NS',
        });
      }
    }
    rounds.set(round, { source, sheet, tables });
  }
  for (const source of workbook.names.filter((name) => /^R[1-9]\d*$/.test(name))) {
    const round = Number(source.slice(1));
    if (!rounds.has(round))
      differences.push({ source, round, field: 'extra score sheet', file: source, expected: null });
  }
  if (differences.length) {
    throw new ImportScheduleError('R 表與 Swiss 對陣資料不一致，停止匯入。', {
      format: { ...format, adopted: null },
      scheduleDifferences: differences.map((difference) => ({
        ...difference,
        category: 'source-internal',
      })),
      mismatchCountByCategory: {
        'source-internal': differences.length,
        'ranking-convention': 0,
        scoring: 0,
      },
    });
  }
  return { format, rounds, summaries, byeVp };
}
