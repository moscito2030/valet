import { displayedBoardNumber } from '../../board-navigation';
import { createCompetition } from '../../competition-record';
import { type Assignment, type BridgeEvent, type Result, type Seat, resultKey } from '../../model';
import { contractScore, project, teamBoardImps } from '../../scoring';
import { boardMetadata, cell, label, numeric, parseContract, parseDeals } from './bridge';
import {
  ImportScheduleError,
  readImportSchedule,
  roundColumn,
  type ImportFormat,
} from './schedule';
import { readWorkbook, type Sheet } from './workbook';

type Value = number | string | null;
type Location = {
  source: string;
  round?: number;
  table?: number;
  original?: number;
  board?: number;
  team?: number;
  room?: 'open' | 'closed';
};
type Difference = Location & { field: string; file: Value } & (
    | { category: 'source-internal'; expected: Value }
    | { category: 'ranking-convention' | 'scoring' | 'expected-by-decision'; valet: Value }
  );
type BoardMapping = { round: number; original: number; board: number };
export type ImportOptions = {
  archived?: boolean;
  date?: string;
  endDate?: string;
  maxBoardNumber?: number;
  deferredMatches?: ReadonlyMap<string, [number, number] | null>;
  boardsPrivate?: boolean;
  organizerId?: string;
  format?: ImportFormat;
};
type Identity = { competitionId: string; stageId: string; timestamp: string };

const teamId = (team: number) => `t${team}`;
const teamNumber = (id: string) => Number(id.slice(1));
const matchKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const boardColumns = { C: ['N', 'E', 'S', 'W'], E: ['None', 'NS', 'EW', 'Both'] } as const;
const positions = [
  { contract: 'G', ns: 'M', ew: 'P' },
  { contract: 'S', ns: 'Y', ew: 'AB' },
] as const;

function readPair(sheet: Sheet, row: number, col: string) {
  const text = label(sheet, row, col);
  const match = /^(.*?)\s*\((開O|閉C)\)$/.exec(text);
  return {
    names: (match?.[1] ?? text).split(/\s+/).filter(Boolean),
    room: match?.[2] === '開O' ? ('open' as const) : match ? ('closed' as const) : undefined,
  };
}

export function buildImport(zip: Buffer, options: ImportOptions, identity: Identity) {
  const workbook = readWorkbook(zip);
  const players = workbook.sheet('Players');
  const roster = [...players.keys()]
    .sort((a, b) => a - b)
    .flatMap((row) => {
      const team = numeric(cell(players, row, 'B'));
      if (row < 3 || !team || !label(players, row, 'C')) return [];
      const captain = label(players, row, 'D');
      const names = [...'EFGHIJ'].map((col) => label(players, row, col)).filter(Boolean);
      return [
        {
          team,
          names,
          participant: {
            id: teamId(team),
            name: label(players, row, 'C'),
            players: names.join('、'),
            ...(captain ? { captain } : {}),
          },
          noHandicap: label(players, row, 'L') !== '',
        },
      ];
    });
  const teams = new Set(roster.map((row) => row.team));
  if (
    roster.length < 2 ||
    teams.size !== roster.length ||
    [...teams].some((team) => !Number.isSafeInteger(team) || team < 1)
  )
    throw new Error('Players 隊號或隊數無效');

  const schedule = readImportSchedule(workbook, teams, options.format ?? 'auto');
  const requested = options.deferredMatches ?? new Map<string, [number, number] | null>();
  const deferred = new Map<
    string,
    { round: number; table: number; teams: [number, number]; vp: [number, number] | null }
  >();
  const swiss = schedule.format.inferred === 'swiss';
  const stageName = swiss
    ? '瑞士制'
    : schedule.format.inferred === 'double-round-robin'
      ? '雙循環'
      : '大循環';
  const competition = createCompetition(
    { name: label(players, 1, 'B'), venue: '' },
    identity.competitionId,
  );
  competition.competition.updatedAt = identity.timestamp;
  competition.competition.archived = Boolean(options.archived);
  const event: BridgeEvent = {
    id: identity.stageId,
    parentEventId: identity.competitionId,
    name: stageName,
    stageName,
    stageOrder: 1,
    stageArchived: Boolean(options.archived),
    organizerId: options.organizerId,
    status: requested.size ? 'live' : 'finished',
    kind: 'teams',
    gameMode: 'bridge',
    teamMethod: 'imp',
    teamFormat: 'league',
    venue: '',
    date: options.date ?? '',
    ...(options.endDate ? { endDate: options.endDate } : {}),
    ...(requested.size ? { provisionalVp: {} } : {}),
    rounds: schedule.rounds.size,
    ...(schedule.byeVp != null ? { byeVp: schedule.byeVp } : {}),
    ...(swiss ? { swiss: { mode: 'current', publications: [] } } : {}),
    boardsPerRound: 0,
    movementImported: true,
    participants: roster.map((row) => row.participant),
    boards: [],
    assignments: [],
    results: {},
    penalties: {},
    demo: false,
    revision: 1,
    updatedAt: identity.timestamp,
    audit: [],
  };
  const differences: Difference[] = [];
  let checks = 0;
  function compare(
    location: Location,
    field: string,
    file: Value,
    expected: Value,
    tolerance = 0,
    category: Difference['category'] = 'scoring',
  ) {
    checks++;
    if (
      typeof file === 'number' && typeof expected === 'number'
        ? Math.abs(file - expected) > tolerance + 1e-9
        : file !== expected
    ) {
      const clean = (value: Value) =>
        typeof value === 'number' ? Number(value.toFixed(8)) : value;
      const base = { ...location, field, file: clean(file) };
      differences.push(
        category === 'source-internal'
          ? { ...base, category, expected: clean(expected) }
          : { ...base, category, valet: clean(expected) },
      );
    }
  }
  function compareSource(location: Location, field: string, file: Value, expected: Value) {
    compare(
      location,
      field,
      file,
      expected,
      0,
      requested.has(`R${location.round}T${location.table}`)
        ? 'expected-by-decision'
        : 'source-internal',
    );
  }
  const unmapped: string[] = [
    'Datum、Butler、頻率、雙明手及衍生欄位由來源保留或由 VALET 另算',
  ];
  const rosterNames = new Set(
    roster.flatMap(({ names, participant }) => [
      ...names,
      ...(participant.captain ? [participant.captain] : []),
    ]),
  );
  const deals = parseDeals(workbook.sheet('Hands'));
  const boardMapping: BoardMapping[] = [];
  const priorDeals = new Map<number, string[]>();
  const repeatedDeals = { same: 0, different: 0 };
  const styles: Record<string, number> = {};
  const sourceStyles: Record<string, number> = {};
  const matches = new Map<string, Assignment[]>();
  const roundTotals: {
    location: Location;
    matchId: string;
    primary: [number | null, number | null];
    duplicate: [number | null, number | null];
  }[] = [];

  for (const [round, { source, sheet, tables }] of schedule.rounds) {
    const hands = deals.get(round);
    if (!hands?.size || (event.boardsPerRound && hands.size !== event.boardsPerRound))
      throw new Error(`Hands 與 R${round} 圈次或牌數不符`);
    event.boardsPerRound = hands.size;
    const byOriginal = new Map<number, number>();
    for (const [table, group] of [...tables].sort(([a], [b]) => a - b)) {
      const first = group.find((view) => view.openNS)!;
      const second = group.find((view) => !view.openNS)!;
      const key = matchKey(first.team, second.team);
      const matchId = swiss ? `swiss-r${round}t${table}` : `r${round}m${table}`;
      const matchRef = `R${round}T${table}`;
      const leavePending = requested.has(matchRef);
      if (leavePending) {
        const vp = requested.get(matchRef)!;
        deferred.set(matchId, { round, table, teams: [first.team, second.team], vp });
        event.provisionalVp![matchId] = { vp };
        const description = vp ? `套用暫定 VP ${vp.join(':')}` : '成績與 VP 留空';
        event.audit.push({
          at: identity.timestamp,
          revision: 1,
          action: 'XLSX 匯入',
          reason: 'Edgar 決定',
          detail: `${matchRef} ${description}`,
        });
        compare(
          { source, round, table },
          'match results',
          'spreadsheet',
          null,
          0,
          'expected-by-decision',
        );
      }
      const namesFor = (room: 'open' | 'closed') => {
        const ns = readPair(sheet, first.row, room === 'open' ? 'C' : 'AJ');
        const ew = readPair(sheet, first.row + 1, room === 'open' ? 'AJ' : 'C');
        const duplicateNS = readPair(sheet, second.row, room === 'open' ? 'AJ' : 'C');
        const duplicateEW = readPair(sheet, second.row + 1, room === 'open' ? 'C' : 'AJ');
        const names: Partial<Record<Seat, string>> = {};
        for (const [pair, duplicate, seats, team] of [
          [ns, duplicateNS, ['N', 'S'], room === 'open' ? first.team : second.team],
          [ew, duplicateEW, ['E', 'W'], room === 'open' ? second.team : first.team],
        ] as const) {
          const location = { source, round, table, team, room };
          compareSource(
            location,
            'duplicate lineup',
            Number(pair.names.join('\0') === duplicate.names.join('\0')),
            1,
          );
          if (pair.room !== room || duplicate.room !== room)
            compareSource(location, 'lineup room', 'inconsistent', room);
          if (pair.names.length !== 2 || pair.names.some((name) => !rosterNames.has(name))) {
            unmapped.push(`${source} 桌 ${table} 隊 ${team} ${room} 搭檔姓名缺漏或無法識別`);
          }
          if (pair.names.length === 2)
            pair.names.forEach((name, i) => {
              names[seats[i]] = name;
            });
        }
        return names;
      };
      const open: Assignment = {
        id: `${matchId}o`,
        matchId,
        round,
        table,
        room: 'open',
        ns: teamId(first.team),
        ew: teamId(second.team),
        boards: [],
        playerNames: namesFor('open'),
      };
      const closed: Assignment = {
        id: `${matchId}c`,
        matchId,
        round,
        table,
        room: 'closed',
        ns: open.ew,
        ew: open.ns,
        boards: [],
        playerNames: namesFor('closed'),
      };
      event.assignments.push(open, closed);
      matches.set(key, [...(matches.get(key) ?? []), open]);
      const originals = new Set<number>();
      for (let offset = 6; offset < 54; offset += 3) {
        const row = first.row + offset;
        const inverseRow = second.row + offset;
        const original = numeric(cell(sheet, row, 'A'));
        if (original === null && numeric(cell(sheet, inverseRow, 'A')) === null) continue;
        const deal = original === null ? undefined : hands.get(original);
        if (original === null || !deal || originals.has(original))
          throw new Error(`${source} 第 ${row} 列牌號與 Hands 不符`);
        originals.add(original);
        const metadata = boardMetadata(label(sheet, row, 'C'), label(sheet, row, 'E'));
        if (!byOriginal.has(original)) {
          const signature = JSON.stringify(Object.values(deal).map((cards) => [...cards].sort()));
          const prior = priorDeals.get(original) ?? [];
          if (prior.length) repeatedDeals[prior.includes(signature) ? 'same' : 'different']++;
          priorDeals.set(original, [...prior, signature]);
          const number = event.boards.length + 1;
          event.boards.push({ number, ...metadata, deal, published: !options.boardsPrivate });
          boardMapping.push({ round, original, board: number });
          byOriginal.set(original, number);
        }
        const board = byOriginal.get(original)!;
        const location = { source, round, table, original, board };
        compareSource(
          location,
          'duplicate board number',
          numeric(cell(sheet, inverseRow, 'A')),
          original,
        );
        const stored = event.boards[board - 1];
        const storedVulnerability = stored.vulnerability === 'All' ? 'Both' : stored.vulnerability;
        for (const [col, expected] of [
          ['C', stored.dealer],
          ['E', storedVulnerability],
        ] as const) {
          const readBoardValue = (sourceRow: number) => {
            const value = label(sheet, sourceRow, col);
            const allowed: readonly string[] = boardColumns[col];
            return allowed.includes(value) ? value : value ? 'unknown' : null;
          };
          const primaryValue = readBoardValue(row);
          compareSource(location, `board ${col}`, primaryValue, expected);
          compareSource(
            location,
            `duplicate board ${col}`,
            readBoardValue(inverseRow),
            primaryValue,
          );
        }
        open.boards.push(board);
        closed.boards.push(board);
        if (leavePending) continue;
        const results: (Result | undefined)[] = [];
        for (const [i, assignment] of [open, closed].entries()) {
          const primary = positions[i],
            secondary = positions[1 - i];
          const raw = label(sheet, row, primary.contract),
            duplicate = label(sheet, inverseRow, secondary.contract);
          const primaryContract = parseContract(raw);
          const secondaryContract = parseContract(duplicate);
          const parsed = primaryContract ?? secondaryContract;
          const position = {
            ...location,
            room: assignment.room as 'open' | 'closed',
            team: teamNumber(assignment.ns),
          };
          const primaryStyle = primaryContract?.style ?? (raw ? 'unknown' : 'blank');
          const secondaryStyle = secondaryContract?.style ?? (duplicate ? 'unknown' : 'blank');
          for (const style of [primaryStyle, secondaryStyle]) {
            sourceStyles[style] = (sourceStyles[style] ?? 0) + 1;
          }
          const acceptedStyle = parsed?.style ?? (raw || duplicate ? 'unknown' : 'blank');
          styles[acceptedStyle] = (styles[acceptedStyle] ?? 0) + 1;
          compareSource(
            position,
            'duplicate contract',
            secondaryContract ? duplicate : secondaryStyle,
            primaryContract ? raw : primaryStyle,
          );
          if (!parsed) {
            unmapped.push(`${source} 桌 ${table} 原牌 ${original} ${assignment.room} 合約無法對應`);
            compare(position, 'contract', raw || duplicate ? 'unknown' : 'blank', null);
            results.push(undefined);
            continue;
          }
          const { style: _, ...contract } = parsed;
          const input = { ...contract, assignmentId: assignment.id, board };
          const nsScore = contractScore(input, stored.vulnerability);
          const result = { ...input, nsScore, updatedAt: identity.timestamp };
          event.results[resultKey(assignment.id, board)] = result;
          results.push(result);
          const readScore = (sourceRow: number, col: string) =>
            label(sheet, sourceRow, col) === 'Average'
              ? 'Average'
              : numeric(cell(sheet, sourceRow, col));
          const average = contract.status === 'average';
          for (const [side, expected] of [
            ['ns', average ? 'Average' : Math.max(0, nsScore)],
            ['ew', Math.max(0, -nsScore)],
          ] as const) {
            const firstScore = readScore(row, primary[side]);
            const secondScore = readScore(inverseRow, secondary[side]);
            compareSource(
              position,
              `duplicate ${side.toUpperCase()} score`,
              secondScore,
              firstScore,
            );
            compare(
              position,
              `${side.toUpperCase()} score`,
              primaryContract ? firstScore : secondScore,
              expected,
            );
          }
        }
        const [x, y] = results;
        const imp = x && y ? teamBoardImps(x, y) : [null, null];
        for (const [team, primaryCol, duplicateCol, score] of [
          [first.team, 'AK', 'AN', imp[0]],
          [second.team, 'AN', 'AK', imp[1]],
        ] as const) {
          const position = { ...location, team };
          const primaryImp = numeric(cell(sheet, row, primaryCol));
          const duplicateImp = numeric(cell(sheet, inverseRow, duplicateCol));
          compareSource(position, 'duplicate board IMP', duplicateImp, primaryImp);
          compare(
            position,
            'board IMP',
            primaryImp ?? duplicateImp,
            score === null ? null : Math.max(0, score),
          );
        }
        for (const sourceRow of [row, inverseRow]) {
          if (label(sheet, sourceRow, 'AQ') || label(sheet, sourceRow, 'AR')) {
            unmapped.push(
              `${source} 桌 ${table} 原牌 ${original} 逐副 COP（以 RoundRobin 的 COP 為準）`,
            );
          }
        }
      }
      if (originals.size !== hands.size)
        throw new Error(`${source} 第 ${table} 桌牌數與 Hands 不符`);
      if (leavePending) continue;
      const totals = (sourceRow: number): [number | null, number | null] => [
        numeric(cell(sheet, sourceRow + 54, 'AK')),
        numeric(cell(sheet, sourceRow + 54, 'AN')),
      ];
      const [firstWon, firstLost] = totals(first.row);
      const [secondWon, secondLost] = totals(second.row);
      roundTotals.push({
        location: { source, round, table, team: first.team },
        matchId,
        primary: [firstWon, firstLost],
        duplicate: [secondLost, secondWon],
      });
    }
    if (event.swiss) {
      const bye = schedule.format.byes.find((item) => item.round === round);
      event.swiss.publications.push({
        round,
        sourceRound: 0,
        sourceRevision: event.revision,
        at: identity.timestamp,
        pairs: event.assignments
          .filter((a) => a.round === round && a.room === 'open')
          .map((a) => [a.ns, a.ew]),
        ...(bye ? { bye: teamId(bye.team) } : {}),
        basis: [],
        byeBasis: [],
        scores: [],
      });
    }
  }
  if (deals.size !== event.rounds) throw new Error('Hands 圈次與 R 表不符');
  if (deferred.size !== requested.size)
    throw new ImportScheduleError('指定的暫定或留空場次不存在。', {
      decisionDifferences: [...requested.keys()].filter(
        (ref) => ![...deferred.values()].some((match) => ref === `R${match.round}T${match.table}`),
      ),
    });
  event.maxBoardNumber =
    options.maxBoardNumber ?? Math.max(...boardMapping.map((item) => item.original));
  const boardDisplayMapping = boardMapping.map((item) => ({
    ...item,
    displayed: displayedBoardNumber(item.board, event),
  }));
  const invalidBoardDisplay = boardDisplayMapping.filter(
    (item) => item.displayed !== item.original,
  );
  if (invalidBoardDisplay.length)
    throw new ImportScheduleError('顯示牌號與原牌號不一致，停止匯入。', {
      maxBoardNumber: event.maxBoardNumber,
      boardDisplayDifferences: invalidBoardDisplay,
    });
  event.movementDescription = [...schedule.rounds.keys()]
    .map(
      (round) =>
        `R${round} 原牌號→賽段牌號 ${boardMapping
          .filter((item) => item.round === round)
          .map((item) => `${item.original}→${item.board}`)
          .join('、')}`,
    )
    .join('；');
  const robin = workbook.names.includes('RoundRobin')
    ? workbook.sheet('RoundRobin')
    : (new Map() as Sheet);
  const robinRows = new Map(
    [...robin.keys()]
      .filter((row) => row >= 3)
      .flatMap((row) => {
        const team = numeric(cell(robin, row, 'A'));
        return team && teams.has(team) ? [[team, row] as const] : [];
      }),
  );
  if (!robin.size) unmapped.push('RoundRobin 缺少工作表，未核對大循環總表');
  else if (robinRows.size !== teams.size) throw new Error('RoundRobin 缺少隊伍');
  const skippedCop = new Map<number, number>();
  const deferredTeams = new Set([...deferred.values()].flatMap((match) => match.teams));
  for (const [team, row] of robinRows) {
    const cop = numeric(cell(robin, row, 'U'));
    if (deferredTeams.has(team) && cop !== null && cop !== 0) {
      skippedCop.set(team, cop);
      compare({ source: 'RoundRobin', team }, 'COP', cop, null, 0, 'expected-by-decision');
    } else if (cop !== null && cop < 0) event.penalties![teamId(team)] = -cop;
    if (
      !skippedCop.has(team) &&
      ((cop !== null && cop > 0) || (cop === null && label(robin, row, 'U')))
    ) {
      unmapped.push(`RoundRobin 隊 ${team} COP 無法對應為罰分`);
      compare({ source: 'RoundRobin', team }, 'COP', cop ?? 'non-numeric', null);
    }
    const carry = numeric(cell(robin, row, 'V'));
    if ((carry !== null && carry !== 0) || (carry === null && label(robin, row, 'V'))) {
      unmapped.push(`RoundRobin 隊 ${team} 帶分/讓分`);
      compare({ source: 'RoundRobin', team }, 'carry/handicap', carry ?? 'non-numeric', null);
    }
  }
  for (const row of roster.filter((row) => row.noHandicap))
    unmapped.push(`Players 隊 ${row.team} 不讓點`);

  const projection = project(event);
  const projectedMatches = new Map(projection.matches.map((match) => [match.id, match]));
  function matchFor(team: number, matchId: string) {
    const match = projectedMatches.get(matchId)!;
    const a = match.a === teamId(team);
    return {
      won: a ? match.impsA : match.impsB,
      lost: a ? match.impsB : match.impsA,
      vp: a ? match.vpA : match.vpB,
    };
  }
  function compareMatch(
    location: Location,
    matchId: string,
    match: NonNullable<ReturnType<typeof matchFor>>,
    won: number | null,
    lost: number | null,
    vp: number | null,
  ) {
    if (deferred.has(matchId)) {
      compare(location, 'match VP', vp, match.vp, 0.01, 'expected-by-decision');
      return;
    }
    compare(location, 'match IMP won', won, match.won);
    compare(location, 'match IMP lost', lost, match.lost);
    compare(location, 'match VP', vp, match.vp, 0.01);
  }
  for (const { location, matchId, primary, duplicate } of roundTotals) {
    const match = projectedMatches.get(matchId)!;
    for (const [index, field, value] of [
      [0, 'match IMP won', match.impsA],
      [1, 'match IMP lost', match.impsB],
    ] as const) {
      compareSource(location, `duplicate ${field}`, duplicate[index], primary[index]);
      compare(location, field, primary[index] ?? duplicate[index], value);
    }
  }
  const totalFor = (team: number) =>
    projection.matches
      .filter((match) => match.a === teamId(team) || match.b === teamId(team))
      .map((match) => matchFor(team, match.id))
      .reduce((total, match) => ({ won: total.won + match.won, lost: total.lost + match.lost }), {
        won: 0,
        lost: 0,
      });
  const primarySwiss = schedule.summaries[0];
  const decisionValues = [...deferred].map(([id, fixture]) => {
    const rounds = primarySwiss.rounds.get(fixture.round)!;
    const rows = fixture.teams.map((team) => rounds.get(team)!.row);
    const fileVp = rows.map((row) =>
      numeric(cell(primarySwiss.sheet, row, roundColumn(fixture.round, 3))),
    );
    const fileImp = rows.map((row) =>
      numeric(cell(primarySwiss.sheet, row, roundColumn(fixture.round, 2))),
    );
    return { ...fixture, id, fileVp, fileImp };
  });
  function decisionDelta(team: number, throughRound = event.rounds) {
    const delta = { vp: -(skippedCop.get(team) ?? 0), won: 0, lost: 0 };
    for (const match of decisionValues) {
      const index = match.teams.indexOf(team);
      if (match.round > throughRound || (index !== 0 && index !== 1)) continue;
      delta.vp += (match.vp?.[index] ?? 0) - (match.fileVp[index] ?? 0);
      delta.won -= match.fileImp[index] ?? 0;
      delta.lost -= match.fileImp[1 - index] ?? 0;
    }
    return delta;
  }
  const scoreCategory = (file: number | null, actual: number | null, delta: number) =>
    file !== null &&
    actual !== null &&
    delta !== 0 &&
    Math.abs(file + delta - actual) <= 0.010000001
      ? ('expected-by-decision' as const)
      : ('scoring' as const);
  const baselineRanks = (standings: typeof projection.standings, round: number) => {
    const scores = standings.map(
      (standing) => (standing.score ?? 0) - decisionDelta(teamNumber(standing.id), round).vp,
    );
    return new Map(
      standings.map((standing, index) => [
        standing.id,
        1 + scores.filter((score) => score > scores[index] + 1e-8).length,
      ]),
    );
  };
  const finalBaselineRanks = baselineRanks(projection.standings, event.rounds);
  const finalStandings = new Map<number, { rank: number | null; vp: number | null }>();
  function compareStanding(
    sheet: Sheet,
    row: number,
    location: Location,
    [score, rank, won, lost]: string[],
  ) {
    const standing = projection.standings.find((value) => value.id === teamId(location.team!))!;
    const totals = totalFor(location.team!);
    const fileVp = numeric(cell(sheet, row, score));
    const fileRank = numeric(cell(sheet, row, rank));
    const fileWon = numeric(cell(sheet, row, won));
    const fileLost = numeric(cell(sheet, row, lost));
    const delta = decisionDelta(location.team!);
    if (!finalStandings.has(location.team!))
      finalStandings.set(location.team!, { rank: fileRank, vp: fileVp });
    compare(
      location,
      'total VP',
      fileVp,
      standing.score,
      0.01,
      scoreCategory(fileVp, standing.score, delta.vp),
    );
    compare(
      location,
      'rank',
      fileRank,
      standing.rank,
      0,
      deferred.size && finalBaselineRanks.get(standing.id) === fileRank
        ? 'expected-by-decision'
        : 'scoring',
    );
    compare(
      location,
      'total IMP won',
      fileWon,
      totals.won,
      0,
      scoreCategory(fileWon, totals.won, delta.won),
    );
    compare(
      location,
      'total IMP lost',
      fileLost,
      totals.lost,
      0,
      scoreCategory(fileLost, totals.lost, delta.lost),
    );
  }
  const robinColumns = [...(robin.get(1) ?? [])].flatMap(([col, value]) => {
    const team = numeric(value);
    return team && teams.has(team) ? [[team, col] as const] : [];
  });
  if (
    robin.size &&
    (new Set(robinColumns.map(([team]) => team)).size !== teams.size ||
      robinColumns.length !== teams.size)
  )
    throw new Error('RoundRobin 對手欄無效');
  for (const [team, row] of robinRows) {
    const location = { source: 'RoundRobin', team };
    for (const [opponent, col] of robinColumns) {
      if (opponent === team) continue;
      const fixtures = matches.get(matchKey(team, opponent)) ?? [];
      if (fixtures.length !== 1) continue;
      const [fixture] = fixtures;
      const match = matchFor(team, fixture.matchId);
      const [won, lost] = label(robin, row + 1, col)
        .split(':')
        .map(numeric);
      compareMatch(
        { ...location, round: fixture.round, table: Number(fixture.table) },
        fixture.matchId,
        match,
        won ?? null,
        lost ?? null,
        numeric(cell(robin, row, col)),
      );
    }
    compareStanding(robin, row, location, ['W', 'X', 'Y', 'Z']);
  }
  if ([...matches.values()].some((fixtures) => fixtures.length > 1) && robin.size) {
    unmapped.push('RoundRobin 的對手欄未區分重複相遇的場次，重複對戰以 Swiss 逐圈核對');
  }
  if (swiss)
    unmapped.push('Swiss 的原始公布時間、配對依據與模式未提供，公布紀錄使用匯入時間且配對依據留空');
  const roundStandings = new Map(
    [...schedule.rounds.keys()].map((round) => {
      const throughRound = project({
        ...event,
        assignments: event.assignments.filter((assignment) => assignment.round <= round),
        swiss: event.swiss && {
          ...event.swiss,
          publications: event.swiss.publications.filter((item) => item.round <= round),
        },
      });
      return [round, new Map(throughRound.standings.map((standing) => [standing.id, standing]))];
    }),
  );
  const openByRoundTable = new Map(
    event.assignments.filter((a) => a.room === 'open').map((a) => [`${a.round}:${a.table}`, a]),
  );
  const rankingConvention = { checked: 0, matched: 0 };
  for (const { source, sheet, rounds } of schedule.summaries) {
    const rawCumulativeVp = new Map<number, number | null>([...teams].map((team) => [team, 0]));
    for (const [round, fixtures] of rounds) {
      for (const [team, { row }] of fixtures) {
        const prior = rawCumulativeVp.get(team) ?? null;
        const vp = numeric(cell(sheet, row, roundColumn(round, 3)));
        rawCumulativeVp.set(team, prior === null || vp === null ? null : prior + vp);
      }
      const rawScores = [...rawCumulativeVp.values()];
      const complete = rawScores.every((score): score is number => score !== null);
      const priorRanks = baselineRanks([...roundStandings.get(round)!.values()], round);
      for (const [team, { row, fixture }] of fixtures) {
        const location = { source, team, round, table: fixture?.table };
        if (fixture) {
          const id = openByRoundTable.get(`${round}:${fixture.table}`)!.matchId;
          const match = matchFor(team, id);
          if (!deferred.has(id))
            compare(
              location,
              'match IMP won',
              numeric(cell(sheet, row, roundColumn(round, 2))),
              match.won,
            );
          compare(
            location,
            'match VP',
            numeric(cell(sheet, row, roundColumn(round, 3))),
            match.vp,
            0.01,
            deferred.has(id) ? 'expected-by-decision' : 'scoring',
          );
        } else {
          const bye = projection.byes?.find(
            (bye) => bye.round === round && bye.participantId === teamId(team),
          );
          compare(
            location,
            'bye VP',
            numeric(cell(sheet, row, roundColumn(round, 3))),
            bye?.awarded ? bye.vp : null,
            0.01,
          );
        }
        const standing = roundStandings.get(round)!.get(teamId(team))!;
        const fileCumulative = numeric(cell(sheet, row, roundColumn(round, 4)));
        compare(
          location,
          'cumulative VP',
          fileCumulative,
          standing.score,
          0.01,
          scoreCategory(fileCumulative, standing.score, decisionDelta(team, round).vp),
        );
        const fileRank = numeric(cell(sheet, row, roundColumn(round, 5)));
        const rawScore = rawCumulativeVp.get(team);
        const rawRank =
          complete && rawScore != null
            ? 1 + rawScores.filter((score) => score > rawScore + 1e-8).length
            : null;
        const matchesConvention = rawRank !== null && rawRank === fileRank;
        if (rawRank !== null && fileRank !== null) {
          rankingConvention.checked++;
          if (matchesConvention) rankingConvention.matched++;
        }
        compare(
          location,
          'round rank',
          fileRank,
          standing.rank,
          0,
          deferred.size && priorRanks.get(standing.id) === fileRank
            ? 'expected-by-decision'
            : matchesConvention
              ? 'ranking-convention'
              : 'scoring',
        );
      }
    }
    for (const [team, { row }] of [...rounds.values()][0]) {
      if (['DI', 'DJ', 'DO', 'DP'].every((col) => !label(sheet, row, col))) continue;
      compareStanding(sheet, row, { source, team }, ['DI', 'DJ', 'DO', 'DP']);
    }
  }
  return {
    rankingConvention,
    decisionValues,
    skippedCop,
    finalStandings,
    boardDisplayMapping,
    format: schedule.format,
    scheduleSources: schedule.summaries.map((summary) => summary.source),
    competition,
    event,
    projection,
    roster,
    differences,
    checks,
    unmapped: [...new Set(unmapped)],
    boardMapping,
    repeatedDeals,
    styles,
    sourceStyles,
    sheetCount: workbook.names.length,
  };
}

export type ImportData = ReturnType<typeof buildImport>;
