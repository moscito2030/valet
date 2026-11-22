import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resultKey, mutationSchema } from '../lib/model';
import { canMutate } from '../lib/mutation-permissions';
import { applyMutation } from '../lib/mutations/apply';
import { audienceEvent } from '../lib/read-models/public-event';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { createEvent } from '../lib/domain/event-factory';
import { makeBoard } from '../lib/domain/board-factory';
import { column, parseContract, parseDeals } from '../lib/import/xlsx/bridge';
import { buildImport } from '../lib/import/xlsx/import';
import { readWorkbook } from '../lib/import/xlsx/workbook';
import { contractScore, imps, project, vp } from '../lib/scoring';
import { swissRoundComplete } from '../lib/swiss';
import { createNormalizedRepository } from '../lib/storage/normalized';
import { runImport } from '../scripts/import-xlsx';
import { createTestDb } from './helpers/sql';

function zip(files: Record<string, string>) {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [index, [path, value]] of Object.entries(files).entries()) {
    const name = Buffer.from(path),
      input = Buffer.from(value);
    const method = index % 2 ? 8 : 0;
    const data = method ? deflateRawSync(input) : input;
    const local = Buffer.alloc(30),
      entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(input), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(input.length, 22);
    local.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    local.copy(entry, 6, 4, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(entry, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(locals.length / 3, 8);
  end.writeUInt16LE(locals.length / 3, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

type FixtureCell = string | number | { type: string; xml: string };
type Cells = Record<string, FixtureCell>;
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

function fixtureScore(text: string) {
  return contractScore({ ...parseContract(text)!, assignmentId: 'synthetic', board: 1 }, 'None');
}

function fixture(
  fault?:
    'scoring' | 'deal' | 'swiss' | 'round-mismatch' | 'summary-mismatch' | 'double-round-robin',
  boardsPerRound = 2,
) {
  const sheets: Record<string, Cells> = {
    Players: {},
    RoundRobin: {},
    Hands: {},
    'Swiss R': {},
    'Swiss T': {},
  };
  const { Players: players, RoundRobin: robin, Hands: hands } = sheets;
  const labels = [...'甲乙丙丁'];
  players.B1 = { type: 's', xml: '<v>0</v>' };
  players.M1 = { type: 'b', xml: '<v>1</v>' };
  players.N1 = { type: 'str', xml: '<v> &#x41;&lt;&amp; </v>' };
  players.O1 = {
    type: 'inlineStr',
    xml: '<is><r><t xml:space="preserve"> a </t></r><r><t>b</t></r></is>',
  };
  let roundPairs = [
    [
      [1, 4],
      [2, 3],
    ],
    [
      [1, 3],
      [4, 2],
    ],
    [
      [2, 1],
      [3, 4],
    ],
  ];
  if (fault === 'swiss') roundPairs = [roundPairs[0], roundPairs[0]];
  if (fault === 'double-round-robin') roundPairs = [...roundPairs, ...roundPairs];
  const totals = Object.fromEntries(
    labels.map((_, i) => [i + 1, { vp: i === 0 && fault !== 'swiss' ? -2 : 0, won: 0, lost: 0 }]),
  );
  for (const [i, name] of labels.entries()) {
    Object.assign(players, {
      [`B${i + 3}`]: i + 1,
      [`C${i + 3}`]: `${name}隊`,
      [`D${i + 3}`]: `${name}一`,
      [`E${i + 3}`]: `${name}一`,
      [`F${i + 3}`]: `${name}二`,
    });
    robin[`${column(i + 2)}1`] = i + 1;
    robin[`A${3 + 2 * i}`] = i + 1;
  }
  robin.U3 = -2;
  for (const [round, pairs] of roundPairs.entries()) {
    for (const name of ['Swiss R', 'Swiss T']) {
      const base = 2 + 6 * round;
      sheets[name][column(base) + '1'] = `第${round + 1}圈`;
      ['對手', '桌次', '國際序分', '勝分', '總勝分', '名次'].forEach((label, index) => {
        sheets[name][column(base + index) + '2'] = label;
      });
    }
    const sheet = (sheets[`R${round + 1}`] = {} as Cells);
    const handsStart = 1 + round * 54;
    hands[`A${handsStart}`] = round + 1;
    const contracts = ['3NXN4', '2DS-1'];
    for (let i = 0; i < boardsPerRound; i++) {
      const offset = (i % 2) * 42,
        row = handsStart + 2 + Math.floor(i / 2) * 13;
      const set = (x: number, y: number, value: FixtureCell) => {
        hands[`${column(x + offset)}${row + y}`] = value;
      };
      const deal = makeBoard(round * boardsPerRound + i + 1).deal;
      set(1, 0, '#');
      set(2, 0, i + 1);
      for (const [seat, col, delta] of [
        ['N', 3, 0],
        ['E', 11, 4],
        ['S', 3, 8],
        ['W', 1, 4],
      ] as const) {
        for (const [index, suit] of [...'SHDC'].entries()) {
          const ranks = deal[seat]
            .filter((card) => card[0] === suit)
            .map((card) => card[1])
            .join('');
          set(col, delta + index, 'ª©¨§'[index]);
          set(col + 1, delta + index, /^\d+$/.test(ranks) ? Number(ranks) : ranks);
        }
      }
    }
    if (fault === 'deal') hands.E3 = 'AA';
    for (const [tableIndex, pair] of pairs.entries()) {
      const table = tableIndex + 1;
      const boardIMP = imps(fixtureScore(contracts[0]) - fixtureScore(contracts[1]));
      for (const [viewIndex, team] of pair.entries()) {
        const opponent = pair[1 - viewIndex],
          row = 4 + (tableIndex + 2 * viewIndex) * 82;
        const set = (col: string, offset: number, value: FixtureCell) => {
          sheet[`${col}${row + offset}`] = value;
        };
        const lineup = (number: number, open: boolean) =>
          `${labels[number - 1]}一 ${labels[number - 1]}二(${open ? '開O' : '閉C'})`;
        set('A', 0, 'NS');
        set('A', 1, 'EW');
        set('R', 0, 'Table');
        set('Y', 0, table);
        set('M', 0, team);
        set('AD', 0, opponent);
        set('C', 0, lineup(team, viewIndex === 0));
        set('C', 1, lineup(team, viewIndex !== 0));
        set('AJ', 0, lineup(opponent, viewIndex !== 0));
        set('AJ', 1, lineup(opponent, viewIndex === 0));
        const [won, lost] = viewIndex === 0 ? [boardIMP, 0] : [0, boardIMP];
        for (let board = 0; board < boardsPerRound; board++) {
          const offset = 6 + board * 3;
          set('A', offset, board + 1);
          set('C', offset, board ? 'E' : 'N');
          set('E', offset, 'None');
          for (const [i, [contractCol, ns, ew]] of [
            ['G', 'M', 'P'],
            ['S', 'Y', 'AB'],
          ].entries()) {
            const text = contracts[(i + viewIndex) % 2];
            const score = fixtureScore(text);
            set(contractCol, offset, text);
            set(ns, offset, Math.max(0, score));
            set(ew, offset, Math.max(0, -score));
          }
          set(
            'AK',
            offset,
            fault === 'scoring' && round === 0 && table === 1 && viewIndex === 0 && !board
              ? won + 1
              : won,
          );
          set('AN', offset, lost);
        }
        set('AK', 54, boardsPerRound * won);
        set('AN', 54, boardsPerRound * lost);
        const opponentCol = column(1 + opponent);
        const robinRow = 1 + 2 * team;
        const matchVP = vp(boardsPerRound * (won - lost), boardsPerRound);
        robin[opponentCol + robinRow] =
          fault === 'scoring' && round === 0 && table === 1 && viewIndex === 0
            ? matchVP - 0.25
            : matchVP;
        robin[opponentCol + (robinRow + 1)] = `${boardsPerRound * won}:${boardsPerRound * lost}`;
        totals[team].vp += matchVP;
        totals[team].won += boardsPerRound * won;
        totals[team].lost += boardsPerRound * lost;
        for (const name of ['Swiss R', 'Swiss T']) {
          const swiss = sheets[name],
            swissRow = team + 2,
            base = 2 + 6 * round;
          swiss[`A${swissRow}`] = team;
          [opponent, table, boardsPerRound * won, matchVP].forEach((value, i) => {
            swiss[column(base + i) + swissRow] = value;
          });
        }
      }
    }
    for (const name of ['Swiss R', 'Swiss T']) {
      const base = 2 + 6 * round;
      for (const [team, total] of Object.entries(totals)) {
        const row = Number(team) + 2;
        sheets[name][column(base + 4) + row] = total.vp;
        sheets[name][column(base + 5) + row] =
          Object.values(totals).filter((other) => other.vp > total.vp + 1e-8).length + 1;
      }
    }
  }
  if (fault === 'scoring') {
    sheets['Swiss R'].H3 = 1;
    sheets['Swiss R'].H4 = 4;
  }
  if (fault === 'round-mismatch') sheets.R1.AD4 = 3;
  if (fault === 'summary-mismatch') {
    sheets['Swiss T'].D3 = 3;
    sheets['Swiss T'].D6 = 3;
  }
  const ranks = Object.entries(totals).sort(([, a], [, b]) => b.vp - a.vp);
  for (const [index, [id, total]] of ranks.entries()) {
    const rank = ranks.findIndex(([, other]) => Math.abs(other.vp - total.vp) < 1e-8) + 1;
    const row = Number(id) * 2 + 1;
    Object.assign(robin, {
      [`W${row}`]: total.vp,
      [`X${row}`]: rank,
      [`Y${row}`]: total.won,
      [`Z${row}`]: total.lost,
    });
    for (const name of ['Swiss R', 'Swiss T']) {
      const swissRow = Number(id) + 2;
      Object.assign(sheets[name], {
        [`DI${swissRow}`]: total.vp,
        [`DJ${swissRow}`]: rank,
        [`DO${swissRow}`]: total.won,
        [`DP${swissRow}`]: total.lost,
      });
    }
    assert.ok(rank <= index + 1);
  }
  for (const name of ['Swiss R', 'Swiss T']) {
    const unusedRound = roundPairs.length + 1;
    const base = 2 + 6 * roundPairs.length;
    sheets[name][column(base) + '1'] = `第${unusedRound}圈`;
    sheets[name][column(base + 4) + '3'] = totals[1].vp;
  }
  if (fault === 'swiss') {
    delete sheets.RoundRobin;
    delete sheets['Swiss R'];
  }
  const names = Object.keys(sheets);
  const files: Record<string, string> = {
    'xl/workbook.xml':
      '<workbook><sheets>' +
      names.map((name, i) => `<sheet name="${name}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' +
      names
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Target="${i % 2 ? '/xl/' : ''}worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
    'xl/sharedStrings.xml':
      '<sst><si><r><t>合成</t></r><r><t xml:space="preserve"> &amp; 例賽 </t></r></si></sst>',
  };
  for (const [index, name] of names.entries()) {
    files[`xl/worksheets/sheet${index + 1}.xml`] =
      '<worksheet><sheetData><row>' +
      Object.entries(sheets[name])
        .map(([ref, value]) => {
          const { type, xml } =
            typeof value === 'object'
              ? value
              : typeof value === 'number'
                ? { type: 'n', xml: `<v>${value}</v>` }
                : { type: 'inlineStr', xml: `<is><t>${escape(value)}</t></is>` };
          return `<c r="${ref}" t="${type}">${xml}</c>`;
        })
        .join('') +
      '</row></sheetData></worksheet>';
  }
  return zip(files);
}

const dateArgs = ['--date', '2026-01-01'];
const identity = {
  competitionId: 'competition',
  stageId: 'stage',
  timestamp: '2026-01-01T00:00:00Z',
};

test('reads worksheet relationships, rich text, entities, numeric and boolean values', () => {
  const players = readWorkbook(fixture()).sheet('Players');
  assert.deepEqual(
    [...players.get(1)!],
    [
      ['B', '合成 & 例賽 '],
      ['M', true],
      ['N', ' A<& '],
      ['O', ' a b'],
    ],
  );
  assert.equal(players.get(3)?.get('B'), 1);
  assert.throws(() => readWorkbook(Buffer.from('invalid')));
});

test('parses every observed contract style and supports redoubles', () => {
  for (const [text, level, strain, doubled, declarer, tricks, status] of [
    ['3NS4', 3, 'NT', 1, 'S', 10, 'played'],
    ['5DS-2', 5, 'D', 1, 'S', 9, 'played'],
    ['3NXN4', 3, 'NT', 2, 'N', 10, 'played'],
    ['3HXS-3', 3, 'H', 2, 'S', 6, 'played'],
    ['3NXXE3', 3, 'NT', 4, 'E', 9, 'played'],
    ['P', 0, 'NT', 1, 'N', 0, 'played'],
    ['A', 0, 'NT', 1, 'N', 0, 'average'],
  ]) {
    const parsed = parseContract(String(text))!;
    assert.deepEqual(
      [parsed.level, parsed.strain, parsed.doubled, parsed.declarer, parsed.tricks, parsed.status],
      [level, strain, doubled, declarer, tricks, status],
    );
  }
  for (const text of ['', 'A+', '3NS8', '2HE-0', '5CS1'])
    assert.equal(parseContract(text), undefined);
});

test('validates decks, renumbers original boards and checks IMP and VP', () => {
  const bytes = fixture();
  const hands = readWorkbook(bytes).sheet('Hands');
  assert.ok(
    [...hands.values()].some((row) =>
      [...row].some(
        ([col, value]) =>
          ['C', 'E', 'M', 'AS', 'AU', 'BC'].includes(col) &&
          typeof value === 'number' &&
          value > 10,
      ),
    ),
  );
  const data = buildImport(bytes, { boardsPrivate: true, organizerId: 'organizer' }, identity);
  assert.deepEqual(data.differences, []);
  assert.deepEqual(data.format, {
    requested: 'auto',
    inferred: 'round-robin',
    adopted: 'round-robin',
    pairFrequency: { 1: 6 },
    hasByes: false,
    byes: [],
  });
  assert.deepEqual(
    data.boardMapping.map(({ original, board }) => [original, board]),
    [
      [1, 1],
      [2, 2],
      [1, 3],
      [2, 4],
      [1, 5],
      [2, 6],
    ],
  );
  assert.deepEqual(data.event.penalties, { t1: 2 });
  assert.equal(data.event.organizerId, 'organizer');
  assert.ok(data.event.boards.every((board) => !board.published));
  assert.equal(data.event.stageArchived, false);
  for (const board of data.event.boards) {
    assert.deepEqual(
      Object.values(board.deal).map((cards) => cards.length),
      [13, 13, 13, 13],
    );
    assert.equal(new Set(Object.values(board.deal).flat()).size, 52);
  }
  assert.throws(() => parseDeals(readWorkbook(fixture('deal')).sheet('Hands')), /52 張/);
  const bad = buildImport(fixture('scoring'), {}, identity);
  assert.deepEqual(
    bad.differences.map(({ field, category }) => [field, category]),
    [
      ['duplicate board IMP', 'source-internal'],
      ['board IMP', 'scoring'],
      ['match VP', 'scoring'],
      ['round rank', 'ranking-convention'],
      ['round rank', 'scoring'],
    ],
  );
});

test('guards CLI and dry-run, imports atomically, and preserves every pre-existing row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'valet-xlsx-'));
  const db = await createTestDb();
  try {
    const file = join(dir, 'synthetic.xlsx'),
      bad = join(dir, 'mismatch.xlsx');
    await writeFile(file, fixture());
    await writeFile(bad, fixture('scoring'));
    let connections = 0;
    const connect = async () => {
      connections++;
      return db.sql;
    };
    const output: string[] = [];
    const print = (message: string) => output.push(message);
    const dryEnv = {
      VALET_IMPORT_XLSX: '1',
      get DATABASE_URL(): string {
        throw new Error('must not read');
      },
    };
    await assert.rejects(runImport([file, '--dry-run'], {}, print, connect), /VALET_IMPORT_XLSX/);
    await runImport([file, '--dry-run'], dryEnv, print, connect);
    assert.equal(connections, 0);
    assert.equal(JSON.parse(output.at(-1)!).results, 24);
    assert.doesNotMatch(output.at(-1)!, /甲一/);
    await runImport([file, '--dry-run', '--show-names'], dryEnv, print, connect);
    assert.match(output.at(-1)!, /甲一/);
    assert.match(output.at(-1)!, /缺少 --date/);
    await assert.rejects(runImport([bad], dryEnv, print, connect), /必須指定 --date/);
    await assert.rejects(
      runImport([bad, ...dateArgs], dryEnv, print, connect),
      /--accept-mismatches/,
    );
    assert.equal(connections, 0);

    const repository = createNormalizedRepository(db.sql);
    const existing = createEvent({
      name: '既有賽事',
      venue: '',
      kind: 'teams',
      names: ['主隊', '客隊'],
      date: '2026-01-01',
      rounds: 1,
      boardsPerRound: 1,
    });
    existing.boards = [{ ...makeBoard(1), published: true }];
    await repository.insertEvent(existing);

    const tableRows = await db.db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'bridge_%'",
    );
    async function snapshot(): Promise<Record<string, string[]>> {
      return Object.fromEntries(
        await Promise.all(
          tableRows.rows.map(
            async ({ tablename }) =>
              [
                tablename,
                (
                  await db.db.query<{ data: string }>(
                    `SELECT to_jsonb(t)::text AS data FROM "${tablename}" t ORDER BY data`,
                  )
                ).rows.map((row) => row.data),
              ] as const,
          ),
        ),
      );
    }
    const env = { VALET_IMPORT_XLSX: '1', DATABASE_URL: 'injected-test-factory' };
    async function assertNoWrites(args: string[], expected: RegExp) {
      const before = await snapshot();
      let transactions = 0;
      const readOnlySql = Object.assign(db.sql.bind(null), {
        transaction: async () => {
          transactions++;
          throw new Error('Unexpected write transaction');
        },
      });
      await assert.rejects(
        runImport([file, ...dateArgs, ...args], env, print, async () => readOnlySql),
        expected,
      );
      assert.equal(transactions, 0);
      assert.deepEqual(await snapshot(), before);
    }
    await db.sql`UPDATE bridge_storage_switch SET mode = 'legacy' WHERE id = 1`;
    await assertNoWrites([], /正規化儲存尚未啟用/);
    await db.sql`UPDATE bridge_storage_switch SET mode = 'normalized' WHERE id = 1`;
    await assertNoWrites(['--organizer-id', 'missing'], /主辦單位不存在或未啟用/);
    await db.sql`INSERT INTO bridge_organizers (id, document) VALUES
      ('inactive', '{"status":"suspended"}'::jsonb),
      ('active', '{"status":"active"}'::jsonb)`;
    await assertNoWrites(['--organizer-id', 'inactive'], /主辦單位不存在或未啟用/);
    const before = await snapshot();
    await runImport([bad, ...dateArgs, '--accept-mismatches'], env, print, connect);
    const ids = JSON.parse(output.at(-1)!);
    const after = await snapshot();
    assert.equal(after.bridge_competitions.length, before.bridge_competitions.length + 1);
    assert.equal(after.bridge_stages.length, before.bridge_stages.length + 1);
    assert.equal(after.bridge_results.length, before.bridge_results.length + 24);
    assert.equal(after.bridge_boards.length, before.bridge_boards.length + 6);
    for (const [name, rows] of Object.entries(after)) {
      if (
        name === 'bridge_stages' ||
        name === 'bridge_competitions' ||
        rows.some((row) => row.includes(ids.stageId) || row.includes(ids.competitionId))
      ) {
        assert.deepEqual(
          rows.filter((row) => !row.includes(ids.stageId) && !row.includes(ids.competitionId)),
          before[name],
          name,
        );
      } else {
        assert.deepEqual(rows, before[name], name);
      }
    }
    await assert.rejects(runImport([file, ...dateArgs], env, print, connect), /已有同名賽事/);
    assert.deepEqual(await snapshot(), after);
    await runImport(
      [
        file,
        ...dateArgs,
        '--allow-duplicate-name',
        '--archived',
        '--boards-private',
        '--organizer-id',
        'active',
      ],
      env,
      print,
      connect,
    );
    const publicIds = JSON.parse(output.at(-1)!);
    const stages = await repository.listEvents();
    const imported = stages.find((row) => row.event.id === publicIds.stageId)!;
    assert.equal(imported.event.stageArchived, true);
    assert.equal(imported.event.organizerId, 'active');
    assert.equal(imported.event.parentEventId, publicIds.competitionId);
    assert.ok(imported.event.boards.every((board) => !board.published));

    const swiss = join(dir, 'swiss.xlsx');
    await writeFile(swiss, fixture('swiss'));
    await runImport(
      [swiss, ...dateArgs, '--allow-duplicate-name', '--format', 'swiss'],
      env,
      print,
      connect,
    );
    const swissIds = JSON.parse(output.at(-1)!);
    const saved = await repository.getEvent(swissIds.stageId);
    assert.ok(swissRoundComplete(saved.event, 2));
    assert.equal(saved.event.swiss?.publications.length, 2);
    assert.equal(saved.projection.received, 16);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('infers Swiss and double round robin from encounters, and preserves published Swiss pairings', () => {
  const data = buildImport(fixture('swiss'), {}, identity);
  assert.equal(data.format.inferred, 'swiss');
  assert.deepEqual(data.scheduleSources, ['Swiss T']);
  assert.deepEqual(data.format.pairFrequency, { 0: 4, 2: 2 });
  assert.deepEqual(data.differences, []);
  assert.equal(data.event.status, 'finished');
  assert.deepEqual(
    data.event.swiss?.publications.map((publication) => publication.pairs),
    [
      [
        ['t1', 't4'],
        ['t2', 't3'],
      ],
      [
        ['t1', 't4'],
        ['t2', 't3'],
      ],
    ],
  );
  assert.equal(data.projection.matches.length, 4);
  assert.equal(data.projection.received, 16);
  const double = buildImport(fixture('double-round-robin'), {}, identity);
  assert.equal(double.format.inferred, 'double-round-robin');
  assert.deepEqual(double.format.pairFrequency, { 2: 6 });
  assert.equal(double.event.teamFormat, 'league');
  assert.equal(double.projection.matches.length, 12);
});

test('stops for explicit format conflicts and schedule disagreements before opening SQL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'valet-xlsx-schedule-'));
  try {
    let connections = 0;
    const connect = async () => {
      connections++;
      throw new Error('must not connect');
    };
    const paths = [
      ['swiss', ['--format', 'round-robin'], /round-robin.*swiss/, 'format'],
      [
        'round-mismatch',
        ['--accept-mismatches'],
        /R 表與 Swiss 對陣資料不一致/,
        'scheduleDifferences',
      ],
      ['summary-mismatch', ['--accept-mismatches'], /Swiss 對陣資料不一致/, 'scheduleDifferences'],
    ] as const;
    for (const [fault, flags, message, key] of paths) {
      const file = join(dir, fault + '.xlsx');
      await writeFile(file, fixture(fault));
      const reports: string[] = [];
      await assert.rejects(
        runImport(
          [file, ...dateArgs, ...flags],
          {
            VALET_IMPORT_XLSX: '1',
            get DATABASE_URL(): string {
              throw new Error('must not read');
            },
          },
          (report) => reports.push(report),
          connect,
        ),
        message,
      );
      assert.ok(JSON.parse(reports[0])[key]);
    }
    assert.equal(connections, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('imports provisional VP and replaces it after both rooms submit all 12 scores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'valet-provisional-xlsx-'));
  const db = await createTestDb();
  try {
    const file = join(dir, 'synthetic.xlsx');
    await writeFile(file, fixture(undefined, 6));
    const env = { VALET_IMPORT_XLSX: '1', DATABASE_URL: 'injected-test-factory' };
    const out: string[] = [];
    const print = (message: string) => out.push(message);
    const connect = async () => db.sql;
    await assert.rejects(
      runImport([file, ...dateArgs, '--dry-run', '--max-board-number', '30'], env, print, connect),
      /顯示牌號與原牌號不一致/,
    );
    await assert.rejects(
      runImport(
        [file, ...dateArgs, '--dry-run', '--provisional-vp', 'R9T1=10:10'],
        env,
        print,
        connect,
      ),
      /場次不存在/,
    );
    await assert.rejects(
      runImport(
        [file, ...dateArgs, '--dry-run', '--provisional-vp', 'R1T1=21:10'],
        env,
        print,
        connect,
      ),
      /VP 不在/,
    );
    await runImport([file, ...dateArgs, '--provisional-vp', 'R1T1=8:12'], env, print, connect);
    const ids = JSON.parse(out.at(-1)!);
    const repository = createNormalizedRepository(db.sql);
    const original = await repository.getEvent(ids.stageId);
    assert.equal(original.event.status, 'live');
    assert.equal(original.event.date, '2026-01-01');
    assert.equal(original.event.stageArchived, false);
    assert.equal(original.event.competition?.archived, false);
    assert.deepEqual(original.event.provisionalVp?.r1m1, { vp: [8, 12] });
    assert.match(original.event.audit[0].detail!, /套用暫定 VP 8:12/);
    assert.equal(original.event.penalties?.t1, undefined);
    const deferred = original.event.assignments.filter((a) => a.matchId === 'r1m1');
    assert.ok(
      deferred.every((a) =>
        a.boards.every((board) => !original.event.results[resultKey(a.id, board)]),
      ),
    );
    const publicView = audienceEvent(original.event, original.projection);
    const provisional = publicView.projection.matches.find((match) => match.id === 'r1m1')!;
    assert.deepEqual([provisional.vpA, provisional.vpB, provisional.provisional], [8, 12, true]);
    assert.equal(publicView.projection.received, 60);
    assert.equal(
      publicView.projection.standings.find((standing) => standing.id === 't1')?.provisional,
      true,
    );

    const remove = mutationSchema.parse({
      action: 'settings',
      status: 'live',
      removeProvisionalVp: 'r1m1',
      reason: '移除暫定 VP',
      revision: original.event.revision,
      requestId: randomUUID(),
    });
    assert.equal(canMutate('admin', remove), false);
    assert.equal(canMutate('director', remove), true);
    const removed = applyMutation(original, remove);
    assert.equal(removed.projection.matches.find((match) => match.id === 'r1m1')?.vpA, null);
    assert.match(removed.event.audit.at(-1)!.detail!, /移除 r1m1 暫定 VP/);

    const { status, style, ...pass } = parseContract('P')!;
    const entries = deferred.flatMap((a) =>
      a.boards.map((board) => ({ assignmentId: a.id, board, ...pass })),
    );
    assert.equal(entries.length, 12);
    const oneRoomCancelled = Object.fromEntries(
      entries
        .slice(0, 6)
        .map((row) => [
          resultKey(row.assignmentId, row.board),
          { ...row, status: 'cancelled' as const, nsScore: 0, updatedAt: original.event.updatedAt },
        ]),
    );
    assert.equal(
      project({
        ...original.event,
        results: { ...original.event.results, ...oneRoomCancelled },
      }).matches.find((match) => match.id === 'r1m1')?.provisional,
      true,
    );
    let saved = original;
    for (const results of [entries.slice(0, 11), entries.slice(11)]) {
      saved = await repository.mutateEvent(
        ids.stageId,
        mutationSchema.parse({
          action: 'results',
          revision: saved.event.revision,
          requestId: randomUUID(),
          results,
        }),
      );
      assert.equal(
        saved.projection.matches.find((match) => match.id === 'r1m1')?.provisional,
        results.length === 11 ? true : undefined,
      );
    }
    const settled = saved.projection.matches.find((match) => match.id === 'r1m1')!;
    assert.deepEqual([settled.vpA, settled.vpB], [10, 10]);
    assert.equal(saved.event.provisionalVp?.r1m1?.vp, null);
    assert.deepEqual(
      [
        audienceEvent(saved.event).projection.matches.find((match) => match.id === 'r1m1')?.vpA,
        audienceEvent(saved.event).projection.standings.find((standing) => standing.id === 't1')
          ?.provisional,
      ],
      [10, undefined],
    );
    assert.match(saved.event.audit.at(-1)!.detail!, /以補登成績取代暫定 VP/);
    assert.equal(saved.event.status, 'review');
    saved = await repository.mutateEvent(
      ids.stageId,
      mutationSchema.parse({
        action: 'settings',
        status: 'finished',
        revision: saved.event.revision,
        requestId: randomUUID(),
        reason: '完成覆核',
      }),
    );
    assert.equal(saved.event.status, 'finished');

    await runImport(
      [file, '--dry-run', '--leave-blank', 'R1T1', '--leave-blank', 'R2T1'],
      env,
      print,
      connect,
    );
    const blank = JSON.parse(out.at(-1)!);
    assert.equal(blank.results, 48);
    assert.equal(blank.provisionalMatches.length, 2);
    assert.equal(blank.provisionalMatches[0].storage.value.vp, null);
    assert.equal(blank.mismatchCountByCategory.scoring, 0);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
