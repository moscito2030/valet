import { DomainError } from '../domain-error';
import type { Sql } from './neon';

export class SwitchFlipped extends Error {
  constructor() {
    super('storage switch flipped');
    this.name = 'SwitchFlipped';
  }
}

export function isUndefinedTable(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === '42P01') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /does not exist|不存在/.test(message) && /bridge_storage_switch|bridge_discussion_threads/.test(message);
}

export type StorageGate = { mode: 'missing' | 'legacy' | 'normalized' };

const splitMessage =
  '正規化儲存已啟用，但舊的 bridge_events 在切換之後又被寫入。為避免新舊資料分裂，已停止讀寫。請還原遷移前的 Neon 分支，或先把新表組回舊表再把開關切回 legacy。';

export async function storageGate(sql: Sql): Promise<StorageGate> {
  try {
    const rows =
    await sql`SELECT mode, legacy_watermark::text AS legacy_watermark FROM bridge_storage_switch WHERE id = 1`;
    if (!rows.length || rows[0].mode !== 'normalized') return { mode: rows.length ? 'legacy' : 'missing' };
    await assertLegacyFrozen(sql, rows[0].legacy_watermark);
    return { mode: 'normalized' };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (isUndefinedTable(error)) return { mode: 'missing' };
    throw error;
  }
}

export async function competitionRedirect(sql: Sql, id: string) {
  const gate = await storageGate(sql);
  if (gate.mode !== 'normalized') return null;
  try {
    const rows = await sql`SELECT to_id FROM bridge_competition_redirects WHERE from_id = ${id}`;
    const target = rows[0]?.to_id;
    return typeof target === 'string' && target !== id ? target : null;
  } catch (error) {
    if (isUndefinedTable(error)) return null;
    throw error;
  }
}

export async function lockStorage(sql: Sql): Promise<'legacy' | 'normalized'> {
  const rows = await sql`SELECT mode, legacy_watermark::text AS legacy_watermark FROM bridge_storage_switch WHERE id = 1 FOR UPDATE`;
  if (rows[0]?.mode !== 'normalized') return 'legacy';
  await assertLegacyFrozen(sql, rows[0].legacy_watermark);
  return 'normalized';
}

async function assertLegacyFrozen(sql: Sql, watermark: unknown) {
  if (typeof watermark !== 'string' || !watermark)
    throw new DomainError(
      '正規化儲存已標記啟用，但沒有舊表水位。為避免新舊資料分裂，已停止讀寫。',
      503,
      'storage-split',
    );
  const newer =
    await sql`SELECT 1 FROM bridge_events WHERE updated_at > ${watermark}::timestamptz LIMIT 1`;
  if (newer.length) throw new DomainError(splitMessage, 503, 'storage-split');
}
