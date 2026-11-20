import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { migrateAccessModel } from '../lib/access/migrate';
import type { StoredEvent } from '../lib/model';

// Assign existing events to the initial organizer. Does not open a database.
async function main() {
  const file = process.argv[2];
  if (process.env.MIGRATE_ACCESS_CODES !== '1' || !file || file.includes('DATABASE_URL')) {
    console.error(
      'Refusing to run. Set MIGRATE_ACCESS_CODES=1 and pass a local events.json path. Do not point this at the production database or 11月社內賽.',
    );
    process.exitCode = 1;
    return;
  }
  const siteAdminSecret = process.env.SITE_ADMIN_PASSWORD;
  const directorSecret = process.env.DIRECTOR_PASSWORD;
  if (!siteAdminSecret || !directorSecret)
    throw new Error('SITE_ADMIN_PASSWORD and DIRECTOR_PASSWORD are required');
  if (siteAdminSecret === directorSecret || siteAdminSecret === process.env.ADMIN_PASSWORD)
    throw new Error('SITE_ADMIN_PASSWORD must be a new credential, not ADMIN_PASSWORD or DIRECTOR_PASSWORD');
  const documents = JSON.parse(await readFile(file, 'utf8')) as StoredEvent[];
  if (!Array.isArray(documents)) throw new Error('events.json must be an array');
  const events = documents.filter((document) => document.event).map((document) => document.event);
  const fingerprint = (list: typeof events) =>
    JSON.stringify(list.map((event) => ({ boards: event.boards, results: event.results, club: event.club })));
  const before = fingerprint(events);
  const migrated = migrateAccessModel(events, { now: new Date().toISOString(), siteAdminSecret, directorSecret });
  if (fingerprint(migrated.events) !== before) throw new Error('遷移改動了牌組、成績或收分連結');
  const byId = new Map(migrated.events.map((event) => [event.id, event]));
  const next = documents.map((document) =>
    document.event && byId.has(document.event.id) ? { ...document, event: byId.get(document.event.id)! } : document,
  );
  await writeFile(file, JSON.stringify(next));
  await writeFile(path.join(path.dirname(file), 'access.json'), JSON.stringify({
    organizers: migrated.organizers,
    codes: migrated.codes,
  }));
  console.log(`Assigned ${migrated.events.length} events to ${migrated.organizers[0].id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
