import { DomainError } from '../domain-error';
import type { Sql } from './neon';

export function isUndefinedTable(error: unknown) {
  return (error as { code?: string })?.code === '42P01';
}

export async function requireNormalizedStorage(sql: Sql): Promise<void> {
  try {
    const rows = await sql`SELECT mode FROM bridge_storage_switch WHERE id = 1`;
    if (rows[0]?.mode === 'normalized') return;
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
  }
  throw new DomainError('正規化儲存尚未啟用，暫停讀寫。請聯絡站台管理員。', 503, 'storage-unavailable');
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
