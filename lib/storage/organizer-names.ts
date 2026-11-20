import type { Sql } from './neon';

export async function readOrganizerNames(sql: Sql) {
  const names = new Map<string, string>();
  try {
    const rows = await sql`SELECT id, document->>'name' AS name FROM bridge_organizers`;
    for (const { id, name } of rows) {
      if (typeof id === 'string' && typeof name === 'string' && name.trim()) names.set(id, name);
    }
  } catch (error) {
    if ((error as { code?: string })?.code !== '42P01') throw error;
  }
  return names;
}
