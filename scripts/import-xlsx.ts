import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dateSchema } from '../lib/model';
import { buildImport, type ImportOptions } from '../lib/import/xlsx/import';
import { ImportScheduleError, importFormats, type ImportFormat } from '../lib/import/xlsx/schedule';
import { importReport } from '../lib/import/xlsx/report';
import { DomainError } from '../lib/domain-error';
import type { Sql } from '../lib/storage/neon';

class ImportUsageError extends Error {}

function parseArgs(args: string[]) {
  const flags = new Set<string>();
  let file: string | undefined;
  let organizerId: string | undefined;
  let format: ImportFormat | undefined;
  const options: ImportOptions = {};
  const matches = new Map<string, [number, number] | null>();
  const vp = '(\\d+(?:\\.\\d+)?)';
  const provisionalPattern = new RegExp(`^(R[1-9]\\d*T[1-9]\\d*)=${vp}:${vp}$`);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--organizer-id' && !organizerId && args[i + 1] && !args[i + 1].startsWith('-')) {
      organizerId = args[++i];
    } else if (
      arg === '--format' &&
      !format &&
      importFormats.includes(args[i + 1] as ImportFormat)
    ) {
      format = args[++i] as ImportFormat;
    } else if (arg === '--date' || arg === '--end-date') {
      const key = arg === '--date' ? 'date' : 'endDate';
      const raw = args[++i];
      if (options[key] !== undefined || !dateSchema.safeParse(raw).success) {
        throw new ImportUsageError('日期必須為有效的 YYYY-MM-DD。');
      }
      options[key] = raw;
    } else if (arg === '--max-board-number') {
      const raw = args[++i];
      if (
        options.maxBoardNumber !== undefined ||
        !/^(0|[1-9]\d*)$/.test(raw ?? '') ||
        !Number.isSafeInteger(Number(raw))
      ) {
        throw new ImportUsageError('牌號上限必須為非負整數。');
      }
      options.maxBoardNumber = Number(raw);
    } else if (arg === '--provisional-vp' || arg === '--leave-blank') {
      const raw = args[++i] ?? '';
      const match = provisionalPattern.exec(raw);
      const key =
        arg === '--provisional-vp'
          ? match?.[1]
          : /^R[1-9]\d*T[1-9]\d*$/.test(raw)
            ? raw
            : undefined;
      const values: [number, number] | null =
        match && arg === '--provisional-vp' ? [Number(match[2]), Number(match[3])] : null;
      if (!key || matches.has(key) || values?.some((value) => value > 20)) {
        throw new ImportUsageError('暫定或留空場次參數無效、重複，或 VP 不在 0–20。');
      }
      matches.set(key, values);
    } else if (
      [
        '--dry-run',
        '--archived',
        '--boards-private',
        '--show-names',
        '--allow-duplicate-name',
        '--accept-mismatches',
      ].includes(arg)
    ) {
      flags.add(arg);
    } else if (!arg.startsWith('-') && !file) {
      file = arg;
    } else {
      throw new ImportUsageError('參數無效，請參閱 docs/xlsx-import.md。');
    }
  }
  if (!file) throw new ImportUsageError('請提供 XLSX 路徑。');
  if (options.endDate && (!options.date || options.endDate < options.date)) {
    throw new ImportUsageError('必須提供開始日期，且結束日期不可早於開始日期。');
  }
  return { file, organizerId, format, flags, options: { ...options, deferredMatches: matches } };
}

export async function runImport(
  args: string[],
  env: Readonly<Record<string, string | undefined>>,
  output: (message: string) => void,
  connect: (connection: string) => Promise<Sql> = async (connection) => {
    const { neonHttp } = await import('../lib/storage/sql-client');
    return neonHttp(connection);
  },
) {
  if (env.VALET_IMPORT_XLSX !== '1')
    throw new ImportUsageError('請設定 VALET_IMPORT_XLSX=1 才能執行 XLSX 匯入。');
  const { file, organizerId, format, flags, options } = parseArgs(args);
  if (!flags.has('--dry-run') && !options.date)
    throw new ImportUsageError('正式匯入必須指定 --date YYYY-MM-DD。');
  let zip: Buffer;
  try {
    zip = await readFile(file);
  } catch {
    throw new ImportUsageError('無法讀取 XLSX 檔案。');
  }
  let data;
  try {
    data = buildImport(
      zip,
      {
        organizerId,
        format,
        ...options,
        archived: flags.has('--archived'),
        boardsPrivate: flags.has('--boards-private'),
      },
      { competitionId: randomUUID(), stageId: randomUUID(), timestamp: new Date().toISOString() },
    );
  } catch (error) {
    if (error instanceof ImportScheduleError) {
      output(JSON.stringify(error.report, null, 2));
      throw new ImportUsageError(error.message);
    }
    // Layout diagnostics use fixed text and numeric coordinates. Generic parser
    // and schema errors can contain source data, so redact those at the CLI boundary.
    const message =
      error instanceof Error &&
      /^(?:Hands |R\d+ |Players |RoundRobin |缺少必要的|牌張的)/.test(error.message)
        ? error.message
        : '無法解析 XLSX 或工作簿格式不符。';
    throw new ImportUsageError(message);
  }
  output(JSON.stringify(importReport(data, flags.has('--show-names')), null, 2));
  if (flags.has('--dry-run')) return;
  if (
    data.differences.some((difference) => difference.category === 'scoring') &&
    !flags.has('--accept-mismatches')
  ) {
    throw new ImportUsageError('交叉比對有差異，未寫入。確認後可指定 --accept-mismatches。');
  }
  const connection = env.DATABASE_URL;
  if (!connection) throw new ImportUsageError('請從環境變數設定 DATABASE_URL。');
  const { insertCompetitionWithStage, DuplicateCompetitionName, InactiveImportOrganizer } =
    await import('../lib/storage/insert-competition-stage');
  try {
    await insertCompetitionWithStage(
      await connect(connection),
      data.competition,
      { event: data.event, projection: data.projection, requests: [] },
      flags.has('--allow-duplicate-name'),
    );
  } catch (error) {
    if (error instanceof DuplicateCompetitionName || error instanceof InactiveImportOrganizer) {
      throw new ImportUsageError(error.message);
    }
    if (error instanceof DomainError && error.code === 'storage-unavailable') {
      throw new ImportUsageError('正規化儲存尚未啟用，停止匯入。');
    }
    throw new ImportUsageError('寫入失敗。請確認連線與正規化儲存設定後重試。');
  }
  output(
    JSON.stringify({ competitionId: data.competition.competition.id, stageId: data.event.id }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  runImport(process.argv.slice(2), process.env, console.log).catch((error: unknown) => {
    console.error(error instanceof ImportUsageError ? error.message : 'XLSX 匯入失敗。');
    process.exitCode = 1;
  });
}
