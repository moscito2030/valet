import { migrateAccessModel } from '../access/migrate';
import type { AccessAudit } from '../access/audit';
import type { AccessCode, Organizer } from '../access/codes';
import type { BridgeEvent } from '../model';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { isUndefinedTable, storageGate } from './switch';

const organizerId = 'ntu-bridge-club';

export type AccessAssignment = {
  mode: 'dry-run' | 'write';
  switch: 'legacy' | 'normalized';
  events: number;
  codes: number;
  legacy: string;
};

function dealText(event: { boards?: { deal?: unknown }[] }) {
  return JSON.stringify((event.boards ?? []).map((board) => board.deal));
}

export async function loadAccessCodes(sql: Sql): Promise<AccessCode[]> {
  try {
    const rows = await sql`SELECT document FROM bridge_access_codes ORDER BY id`;
    return rows.map((row) => row.document as AccessCode);
  } catch (error) {
    if (isUndefinedTable(error)) return [];
    throw error;
  }
}

export async function assignAccessRecords(
  sql: Sql,
  input: { siteAdminSecret: string; directorSecret: string; now: string; dryRun: boolean },
): Promise<AccessAssignment> {
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。請用 HTTPS 連線，不要用 Postgres 連線埠。');
  if (!input.siteAdminSecret || input.siteAdminSecret === input.directorSecret)
    throw new Error('站台管理員密碼必須另行設定，且不能與裁判密碼相同');
  const gate = await storageGate(sql);
  if (gate.mode === 'missing') throw new Error('storage switch is missing');
  const source =
    gate.mode === 'normalized'
      ? await sql`SELECT id, settings AS event FROM bridge_stages ORDER BY id`
      : await sql`SELECT id, document->'event' AS event FROM bridge_events WHERE document ? 'event' ORDER BY id`;
  const events = source.map((row) => row.event as BridgeEvent);
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
  const legacyBoardsBefore =
    gate.mode === 'legacy'
      ? await sql`SELECT id, document->'event'->'boards' AS boards FROM bridge_events WHERE document ? 'event' ORDER BY id`
      : [];
  const existingCodes = new Set(
    (await sql`SELECT id FROM bridge_access_codes`).map((row) => String(row.id)),
  );
  const newCodes = migrated.codes.filter((code) => !existingCodes.has(code.id));
  const missingOrganizer = events.filter((event) => event.organizerId !== organizerId);
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
      if (gate.mode === 'normalized')
        cap.sql`UPDATE bridge_stages
          SET settings = jsonb_set(settings, '{organizerId}', to_jsonb(${organizerId}::text))
          WHERE id = ${event.id} AND NOT (settings ? 'organizerId')`;
      else
        cap.sql`UPDATE bridge_events
          SET document = jsonb_set(document, '{event,organizerId}', to_jsonb(${organizerId}::text)), updated_at = now()
          WHERE id = ${event.id} AND document ? 'event' AND NOT (document->'event' ? 'organizerId')`;
    }
    await commitSql(sql, cap.batches);
  }
  const boardsAfter =
    await sql`SELECT event_id, board_number, document_json FROM bridge_boards ORDER BY event_id, board_number`;
  if (JSON.stringify(boardsBefore) !== JSON.stringify(boardsAfter)) throw new Error('deals changed');
  if (gate.mode === 'legacy') {
    const legacyBoardsAfter =
      await sql`SELECT id, document->'event'->'boards' AS boards FROM bridge_events WHERE document ? 'event' ORDER BY id`;
    const cards = (rows: Record<string, unknown>[]) =>
      JSON.stringify(
        rows.map((row) =>
          ((row.boards as { deal?: Record<string, string[]> }[] | null) ?? []).map((board) =>
            board.deal ? ['N', 'E', 'S', 'W'].map((seat) => (board.deal?.[seat] ?? []).join('')) : [],
          ),
        ),
      );
    if (cards(legacyBoardsBefore) !== cards(legacyBoardsAfter)) throw new Error('deals changed');
  }
  return {
    mode: input.dryRun ? 'dry-run' : 'write',
    switch: gate.mode,
    events: missingOrganizer.length,
    codes: newCodes.length,
    legacy: gate.mode === 'normalized' ? 'untouched' : input.dryRun ? `would update ${missingOrganizer.length}` : `updated ${missingOrganizer.length}`,
  };
}

export function formatAccessAssignment(report: AccessAssignment) {
  return [
    `mode: ${report.mode}`,
    `switch: ${report.switch}`,
    `events: ${report.events}`,
    `codes: ${report.codes}`,
    `legacy: ${report.legacy}`,
    'deals: unchanged',
  ].join('\n');
}
