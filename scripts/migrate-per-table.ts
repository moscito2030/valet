import { parseArgs } from 'node:util';
import {
  formatPerTableStage,
  MigrationError,
  migratePerTable,
  requireMigrationAuthorization,
} from '../lib/storage/per-table-migration';
import { neonHttp } from '../lib/storage/sql-client';

async function main() {
  const args = (() => {
    try {
      return parseArgs({
        options: { 'dry-run': { type: 'boolean' }, apply: { type: 'boolean' }, down: { type: 'boolean' },
          event: { type: 'string', multiple: true } },
      }).values;
    } catch {
      throw new MigrationError('參數錯誤。可用 --dry-run、--apply、--down，以及可重複的 --event <id>。');
    }
  })();
  if ([args['dry-run'], args.apply, args.down].filter(Boolean).length > 1)
    throw new MigrationError('請只選一種執行模式。');
  const mode = args.apply ? 'apply' : args.down ? 'down' : 'dry-run';
  const authorization = process.env.VALET_PER_TABLE_MIGRATION;
  requireMigrationAuthorization(mode, authorization);
  const url = process.env.DATABASE_URL;
  if (!url) throw new MigrationError('請先設定 DATABASE_URL。');

  const print = (message: string) => console.log(message.replaceAll(url, '[已隱藏]'));
  const special = new Set(args.event ?? []);
  const report = await migratePerTable(neonHttp(url), {
    mode,
    authorization,
    onStage: (stage) => print(formatPerTableStage(stage, mode, special.delete(stage.id))),
  });
  for (const id of special) print(`警告：找不到要特別列印的賽段 ${id}。`);
  print(mode === 'down'
    ? `共檢查 ${report.stages.length} 個賽段，刪除 ${report.stages.reduce((sum, stage) => sum + stage.deleted, 0)} 筆影子資料。`
    : `共檢查 ${report.stages.length} 個賽段，${mode === 'dry-run' ? '預計新增' : '新增'} ${report.added} 筆影子資料。`);
}

main().catch((error: unknown) => {
  const message = error instanceof MigrationError || (error as { code?: string }).code === 'storage-unavailable'
    ? (error as Error).message
    : '遷移執行失敗，請確認連線、資料庫權限與資料表狀態。';
  const url = process.env.DATABASE_URL;
  console.error(url ? message.replaceAll(url, '[已隱藏]') : message);
  process.exitCode = 1;
});
