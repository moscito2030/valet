import { deriveRounds, deriveTableStates } from '../per-table-state';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { queueDeletePerTableState, readPerTableSchema } from './per-table-rows';
import { loadStage } from './rows';
import { normalizedSchemaStatements } from './schema';
import { requireNormalizedStorage } from './switch';

type Mode = 'dry-run' | 'apply' | 'down';
type Fingerprint = Record<string, { count: number; hash: string }>;
type StageReport = {
  id: string;
  tables: number;
  rounds: number;
  skipped: number;
  deleted: number;
  before: Fingerprint;
  after: Fingerprint;
  warnings: string[];
};
type MigrationOptions = { mode: Mode; authorization?: string; onStage?: (stage: StageReport) => void };

const migrationName = 'per-table-v1';

export function requireMigrationAuthorization(mode: Mode, authorization?: string) {
  if (mode !== 'dry-run' && authorization !== '1')
    throw new MigrationError('執行寫入或回退前，請設定 VALET_PER_TABLE_MIGRATION=1。');
}

export class MigrationError extends Error {}

function fingerprint(sql: Sql, id: string, expected: Fingerprint | null = null) {
  return sql`WITH hashes AS (
    SELECT 'bridge_stages' AS name, md5(row_to_json(t)::text) AS hash FROM bridge_stages t WHERE id = ${id}
    UNION ALL SELECT 'bridge_participants', md5(row_to_json(t)::text) FROM bridge_participants t WHERE event_id = ${id}
    UNION ALL SELECT 'bridge_assignments', md5(row_to_json(t)::text) FROM bridge_assignments t WHERE event_id = ${id}
    UNION ALL SELECT 'bridge_boards', md5(row_to_json(t)::text) FROM bridge_boards t WHERE event_id = ${id}
    UNION ALL SELECT 'bridge_results', md5(row_to_json(t)::text) FROM bridge_results t WHERE event_id = ${id}
    UNION ALL SELECT 'bridge_penalties', md5(row_to_json(t)::text) FROM bridge_penalties t WHERE event_id = ${id}
    UNION ALL SELECT 'bridge_audit', md5(row_to_json(t)::text) FROM bridge_audit t WHERE event_id = ${id}
    UNION ALL SELECT 'bridge_requests', md5(row_to_json(t)::text) FROM bridge_requests t WHERE event_id = ${id}
  ), summary AS (
    SELECT names.name, count(hash)::int AS count,
      left(encode(sha256(convert_to(coalesce(string_agg(hash, '' ORDER BY hash COLLATE "C"), ''), 'UTF8')), 'hex'), 16) AS hash
    FROM (VALUES ('bridge_stages'), ('bridge_participants'), ('bridge_assignments'), ('bridge_boards'),
       ('bridge_results'), ('bridge_penalties'), ('bridge_audit'), ('bridge_requests')) AS names(name)
    LEFT JOIN hashes USING (name)
    GROUP BY names.name
  ), snapshot AS (
    SELECT jsonb_object_agg(name, jsonb_build_object('count', count, 'hash', hash) ORDER BY name) AS value FROM summary
  )
  SELECT value, 1 / CASE WHEN ${expected === null} OR value = ${JSON.stringify(expected)}::jsonb THEN 1 ELSE 0 END
  FROM snapshot`;
}

function tableRows(sql: Sql, id: string) {
  return sql`SELECT assignment_id, content_hash, version, confirmed_version, confirmed_at::text, confirmed_forced
    FROM bridge_table_state WHERE event_id = ${id} ORDER BY assignment_id`;
}

function roundRows(sql: Sql, id: string) {
  return sql`SELECT round, state, settled_at::text, settled_forced FROM bridge_rounds WHERE event_id = ${id} ORDER BY round`;
}

function markerRows(sql: Sql, id: string) {
  return sql`SELECT name FROM bridge_migrations WHERE stage_id = ${id} AND name = ${migrationName}`;
}

async function inspectStage(sql: Sql, id: string, schema: Awaited<ReturnType<typeof readPerTableSchema>>) {
  const [initial] = await fingerprint(sql, id);
  const before = initial.value as Fingerprint;
  const loaded = await loadStage(sql, id);
  if (!loaded) throw new MigrationError(`賽段 ${id} 已不存在，請暫停寫入後重試。`);
  const tables = deriveTableStates(loaded.stored.event);
  const rounds = deriveRounds(loaded.stored.event);
  const [existingTables, existingRounds, markers] = await Promise.all([
    schema.tables ? tableRows(sql, id) : [],
    schema.rounds ? roundRows(sql, id) : [],
    schema.migrations ? markerRows(sql, id) : [],
  ]);
  const tablesById = new Map(tables.map((row) => [row.assignmentId, row]));
  const roundsByNumber = new Map(rounds.map((row) => [row.round, row]));
  const warnings: string[] = [];
  for (const row of existingTables) {
    const key = String(row.assignment_id);
    const expected = tablesById.get(key);
    if (!expected || row.content_hash !== expected.contentHash
      || row.confirmed_version !== (expected.accepted ? row.version : null)
      || (row.confirmed_at === null ? null : Date.parse(String(row.confirmed_at)))
        !== (expected.confirmedAt === null ? null : Date.parse(expected.confirmedAt))
      || row.confirmed_forced !== expected.forced)
      warnings.push(`桌 ${key} 的影子資料與既有賽段資料不一致。`);
    tablesById.delete(key);
  }
  for (const row of existingRounds) {
    const key = Number(row.round);
    if (row.state !== roundsByNumber.get(key)?.state || row.settled_at !== null || row.settled_forced !== false)
      warnings.push(`第 ${key} 圈的影子資料與既有賽段資料不一致。`);
    roundsByNumber.delete(key);
  }
  await fingerprint(sql, id, before);
  return {
    id, before, tables, rounds, existingTables, existingRounds, markers, warnings,
    revision: loaded.stored.event.revision,
    missingTables: tablesById.size, missingRounds: roundsByNumber.size,
  };
}

type Snapshot = Awaited<ReturnType<typeof inspectStage>>;

function queueSeed(sql: Sql, stage: Snapshot) {
  const { id, revision, before } = stage;
  sql`INSERT INTO bridge_table_state
    (event_id, assignment_id, content_hash, confirmed_version, confirmed_at, confirmed_forced)
    SELECT ${id}, "assignmentId", "contentHash", CASE WHEN accepted THEN 1 END, "confirmedAt", forced
    FROM jsonb_to_recordset(${JSON.stringify(stage.tables)}::jsonb)
      AS x("assignmentId" text, "contentHash" text, accepted boolean, "confirmedAt" timestamptz, forced boolean)
    ON CONFLICT (event_id, assignment_id) DO NOTHING RETURNING 1`;
  sql`INSERT INTO bridge_rounds (event_id, round, state)
    SELECT ${id}, round, state FROM jsonb_to_recordset(${JSON.stringify(stage.rounds)}::jsonb) AS x(round int, state text)
    ON CONFLICT (event_id, round) DO NOTHING RETURNING 1`;
  sql`INSERT INTO bridge_migrations (name, stage_id, stage_revision, fingerprint)
    VALUES (${migrationName}, ${id}, ${revision}, ${JSON.stringify(before)})
    ON CONFLICT (name, stage_id) DO NOTHING`;
}

function queueDown(sql: Sql, stage: Snapshot, schema: Awaited<ReturnType<typeof readPerTableSchema>>) {
  const { id, existingTables, existingRounds } = stage;
  // Recheck the inspected shadow rows after taking the same stage lock as the writer.
  if (schema.tables) {
    sql`SELECT 1 / CASE WHEN coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY assignment_id) FROM (
        SELECT assignment_id, content_hash, version, confirmed_version, confirmed_at::text, confirmed_forced
        FROM bridge_table_state WHERE event_id = ${id}
      ) t), '[]'::jsonb) = ${JSON.stringify(existingTables)}::jsonb THEN 1 ELSE 0 END`;
  }
  if (schema.rounds) {
    sql`SELECT 1 / CASE WHEN coalesce((
      SELECT jsonb_agg(to_jsonb(t) ORDER BY round) FROM (
        SELECT round, state, settled_at::text, settled_forced FROM bridge_rounds WHERE event_id = ${id}
      ) t), '[]'::jsonb) = ${JSON.stringify(existingRounds)}::jsonb THEN 1 ELSE 0 END`;
  }
  if (schema.tables && schema.rounds) queueDeletePerTableState(sql, id);
  if (schema.migrations)
    sql`DELETE FROM bridge_migrations WHERE stage_id = ${id} AND name = ${migrationName}`;
}

export async function migratePerTable(sql: Sql, options: MigrationOptions) {
  const { mode } = options;
  requireMigrationAuthorization(mode, options.authorization);
  await requireNormalizedStorage(sql);
  if (mode === 'apply')
    await commitSql(sql, normalizedSchemaStatements.map((text) => ({ text, values: [] })));
  const schema = await readPerTableSchema(sql);
  if (mode === 'down' && (schema.tables !== schema.rounds || (schema.migrations && !schema.tables)))
    throw new MigrationError('影子資料表不完整，已停止回退。');
  const ids = (await sql`SELECT id FROM bridge_stages ORDER BY id`).map(({ id }) => String(id));
  const reports: StageReport[] = [];
  const snapshots = new Map<string, Snapshot>();
  async function inspect(id: string) {
    try {
      return await inspectStage(sql, id, schema);
    } catch (error) {
      if ((error as { code?: string }).code === '22012')
        throw new MigrationError(`賽段 ${id} 的既有資料指紋已變更，請暫停寫入後重試。`);
      throw error;
    }
  }
  if (mode === 'down') {
    const issues: string[] = [];
    for (const id of ids) {
      const stage = await inspect(id);
      snapshots.set(id, stage);
      issues.push(...stage.warnings.map((warning) => `賽段 ${id}：${warning}`));
      if ((stage.markers.length || stage.existingTables.length || stage.existingRounds.length)
        && (stage.missingTables || stage.missingRounds))
        issues.push(`賽段 ${id} 缺少 ${stage.missingTables} 筆桌狀態及 ${stage.missingRounds} 筆圈狀態。`);
    }
    if (issues.length) throw new MigrationError(['影子資料有差異，已停止回退。', ...issues].join('\n'));
  }
  for (const id of ids) {
    const stage = snapshots.get(id) ?? await inspect(id);
    const report: StageReport = {
      id, before: stage.before, after: stage.before, warnings: stage.warnings,
      tables: stage.missingTables, rounds: stage.missingRounds, deleted: 0,
      skipped: stage.tables.length + stage.rounds.length - stage.missingTables - stage.missingRounds,
    };
    if (mode !== 'dry-run') {
      const cap = captureSql();
      void fingerprint(cap.sql, id, stage.before);
      cap.sql`SELECT id FROM bridge_stages WHERE id = ${id} FOR UPDATE`;
      if (mode === 'apply') queueSeed(cap.sql, stage);
      else {
        // Verify the stage again after acquiring its lock and before checking shadow data.
        void fingerprint(cap.sql, id, stage.before);
        queueDown(cap.sql, stage, schema);
      }
      void fingerprint(cap.sql, id, stage.before);
      try {
        const results = await commitSql(sql, cap.batches);
        report.after = results.at(-1)?.[0].value as Fingerprint;
        report.tables = mode === 'apply' ? results[2].length : 0;
        report.rounds = mode === 'apply' ? results[3].length : 0;
        report.skipped = mode === 'apply' ? stage.tables.length + stage.rounds.length - report.tables - report.rounds : 0;
        report.deleted = mode === 'down' ? stage.existingTables.length + stage.existingRounds.length : 0;
      } catch (error) {
        if ((error as { code?: string }).code === '22012')
          throw new MigrationError(`賽段 ${id} 的資料在遷移期間變更，已回滾該賽段。請暫停寫入後重試。`);
        throw error;
      }
    }
    reports.push(report);
    options.onStage?.(report);
  }
  return { stages: reports, added: reports.reduce((sum, stage) => sum + stage.tables + stage.rounds, 0) };
}

export function formatPerTableStage(stage: StageReport, mode: Mode, special = false) {
  const action = mode === 'dry-run' ? '預計新增' : '新增';
  return [
    `賽段 ${stage.id} ${action}桌狀態 ${stage.tables} 筆、圈狀態 ${stage.rounds} 筆，略過 ${stage.skipped} 筆，刪除 ${stage.deleted} 筆。`,
    ...Object.entries(stage.before).sort(([left], [right]) => left.localeCompare(right)).map(([name, before]) => {
      const after = stage.after[name];
      const highlighted = special && (name === 'bridge_boards' || name === 'bridge_results') ? '特別列印 ' : '';
      return `  ${highlighted}${name} 執行前 ${before.count} 筆 ${before.hash}，執行後 ${after.count} 筆 ${after.hash}`;
    }),
    ...stage.warnings.map((warning) => `  警告：${warning}`),
  ].join('\n');
}
