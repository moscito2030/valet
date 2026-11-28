import { DomainError } from '../domain-error';
import type { Sql } from './neon';

export function isUndefinedTable(error: unknown) {
  return (error as { code?: string })?.code === '42P01';
}

function storageUnavailable() {
  return new DomainError('正規化儲存尚未啟用，暫停讀寫。請聯絡站台管理員。', 503, 'storage-unavailable');
}

export function missingStorage(error: unknown): never {
  if (isUndefinedTable(error) || (error as { code?: string }).code === '42703') throw storageUnavailable();
  throw error;
}

export function assertNormalizedMode(row?: Record<string, unknown>) {
  if (row?.mode !== 'normalized' || !row.per_table_at) throw storageUnavailable();
}

export async function requireNormalizedStorage(sql: Sql): Promise<void> {
  const [row] = await sql`SELECT mode, per_table_at FROM bridge_storage_switch WHERE id = 1`.catch(missingStorage);
  assertNormalizedMode(row);
}

export async function competitionRedirect(sql: Sql, id: string) {
  await requireNormalizedStorage(sql);
  try {
    const rows = await sql`SELECT to_id FROM bridge_competition_redirects WHERE from_id = ${id}`;
    const target = rows[0]?.to_id;
    return typeof target === 'string' && target !== id ? target : null;
  } catch (error) {
    if (isUndefinedTable(error)) return null;
    throw error;
  }
}
