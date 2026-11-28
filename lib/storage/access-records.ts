import { migrateAccessModel } from '../access/migrate';
import type { AccessAudit } from '../access/audit';
import type { AccessCode } from '../access/codes';
import type { BridgeEvent } from '../model';
import { captureSql, commitSql, queueDataVersion } from './batch';
import { loadStage, queueCompetitionOrganizer } from './rows';
import { queuePublicSnapshot } from './projection';
import { stageCompetitionId } from '../competition-record';
import type { Sql } from './neon';
import { isUndefinedTable, requireNormalizedStorage } from './switch';

const organizerId = 'ntu-bridge-club';

export type AccessAssignment = {
  mode: 'dry-run' | 'write';
  events: number;
  codes: number;
};

function dealText(event: { boards?: { deal?: unknown }[] }) {
  return JSON.stringify((event.boards ?? []).map((board) => board.deal));
}

export async function loadAccessCodes(sql: Sql): Promise<AccessCode[]> {
  await requireNormalizedStorage(sql);
  try {
    const rows = await sql`SELECT document FROM bridge_access_codes ORDER BY id`;
    return rows.map((row) => row.document as AccessCode);
  } catch (error) {
    if (isUndefinedTable(error)) return [];
    throw error;
  }
}

export async function loadAccessCode(sql: Sql, hash: string) {
  const [row] = await sql`SELECT document FROM bridge_access_codes WHERE document->>'hash' = ${hash} ORDER BY id LIMIT 1`;
  return row?.document as AccessCode | undefined;
}

export async function assignAccessRecords(
  sql: Sql,
  input: { siteAdminSecret: string; directorSecret: string; now: string; dryRun: boolean },
): Promise<AccessAssignment> {
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。請用 HTTPS 連線，不要用 Postgres 連線埠。');
  if (!input.siteAdminSecret || input.siteAdminSecret === input.directorSecret)
    throw new Error('站台管理員密碼必須另行設定，且不能與裁判密碼相同');
  await requireNormalizedStorage(sql);
  const source = await sql`SELECT id, settings AS event FROM bridge_stages ORDER BY id`;
  const tokens = await sql`SELECT event_id, device_key, token_hash FROM bridge_club_tokens`;
  const events = source.map(row => {
    const event = row.event as BridgeEvent;
    if (event.club) event.club.tokens = Object.fromEntries(tokens.filter(t => t.event_id === row.id)
      .map(t => [String(t.device_key), String(t.token_hash)]));
    return event;
  });
  const beforeDeals = new Map(events.map((event) => [event.id, dealText(event)]));
  const migrated = migrateAccessModel(events, {
    now: input.now,
    siteAdminSecret: input.siteAdminSecret,
    directorSecret: input.directorSecret,
  });
  for (const event of migrated.events) {
    if (dealText(event) !== beforeDeals.get(event.id)) throw new Error(`deals changed ${event.id}`);
  }
  const boardsBefore =
    await sql`SELECT event_id, board_number, document_json FROM bridge_boards ORDER BY event_id, board_number`;
  const existingCodes = new Set(
    (await sql`SELECT id FROM bridge_access_codes`).map((row) => String(row.id)),
  );
  const newCodes = migrated.codes.filter((code) => !existingCodes.has(code.id));
  const missingOrganizer = events.filter((event) => event.organizerId == null);
  if (!input.dryRun && (missingOrganizer.length || newCodes.length)) {
    const cap = captureSql();
    cap.sql`INSERT INTO bridge_organizers (id, document)
      VALUES (${organizerId}, ${JSON.stringify(migrated.organizers[0])}::jsonb)
      ON CONFLICT (id) DO NOTHING`;
    for (const code of newCodes)
      cap.sql`INSERT INTO bridge_access_codes (id, document)
        VALUES (${code.id}, ${JSON.stringify(code)}::jsonb)
        ON CONFLICT (id) DO NOTHING`;
    for (const event of missingOrganizer) {
      const audit: AccessAudit = {
        at: input.now,
        actorCodeId: 'code-admin',
        actorName: '站台管理員',
        action: '指定主辦單位',
        target: event.id,
        before: event.organizerId ?? null,
        after: organizerId,
        viaAgent: false,
        organizerId,
        eventId: event.id,
      };
      cap.sql`INSERT INTO bridge_access_audit (id, document)
        VALUES (${`assign-${event.id}`}, ${JSON.stringify(audit)}::jsonb)
        ON CONFLICT (id) DO NOTHING`;
      const prior = (await loadStage(sql, event.id, false))!;
      queueDataVersion(cap.sql, event.id);
      cap.sql`UPDATE bridge_stages
        SET revision = current_setting('valet.data_version')::int, settings = jsonb_set(settings, '{organizerId}', to_jsonb(${organizerId}::text))
        WHERE id = ${event.id} AND organizer_id IS NULL`;
      queuePublicSnapshot(cap.sql, { ...prior.stored.event, organizerId }, prior.publicVersion);
    }
    for (const id of new Set(missingOrganizer.map(stageCompetitionId))) {
      queueCompetitionOrganizer(cap.sql, id);
      cap.sql`UPDATE bridge_competitions SET revision = revision + 1 WHERE id = ${id}`;
    }
    await commitSql(sql, cap.batches);
  }
  const boardsAfter =
    await sql`SELECT event_id, board_number, document_json FROM bridge_boards ORDER BY event_id, board_number`;
  if (JSON.stringify(boardsBefore) !== JSON.stringify(boardsAfter)) throw new Error('deals changed');
  return {
    mode: input.dryRun ? 'dry-run' : 'write',
    events: missingOrganizer.length,
    codes: newCodes.length,
  };
}

export function formatAccessAssignment(report: AccessAssignment) {
  return [
    `mode: ${report.mode}`,
    `events: ${report.events}`,
    `codes: ${report.codes}`,
    'deals: unchanged',
  ].join('\n');
}
