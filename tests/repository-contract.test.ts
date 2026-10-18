import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { competitionCatalog } from '../lib/competitions';
import { canMutate } from '../lib/mutation-permissions';
import { createCompetition } from '../lib/competition-record';
import { DomainError } from '../lib/domain-error';
import { createEvent } from '../lib/domain/event-factory';
import { mutationSchema, resultKey, type StoredEvent } from '../lib/model';
import { project } from '../lib/scoring';
import { createDemoRepository } from '../lib/storage/demo';
import { createLocalRepository } from '../lib/storage/local';
import { createNeonRepository, type Sql } from '../lib/storage/neon';
import type { EventRepository } from '../lib/storage/repository';

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const conflict = (e: unknown) => e instanceof DomainError && e.status === 409;
const stage = () =>
  createEvent({
    name: '儲存契約測試',
    kind: 'teams',
    date: '2026-10-18',
    venue: '原地點',
    names: ['甲隊', '乙隊', '丙隊', '丁隊'],
    rounds: 2,
    boardsPerRound: 2,
  });
const command = (extra: object, revision = 1, requestId = randomUUID()) =>
  mutationSchema.parse({
    ...(!('action' in extra) ? { action: 'penalty', participantId: 't1', amount: 1 } : {}),
    reason: '契約驗證',
    revision,
    requestId,
    ...extra,
  });

async function harness(
  kind: 'local' | 'postgres',
): Promise<{
  repo: EventRepository;
  seedLegacy: (stored: StoredEvent) => Promise<void>;
  close: () => Promise<void>;
}> {
  if (kind === 'local') {
    const directory = await mkdtemp(path.join(tmpdir(), 'valet-repository-')),
      file = path.join(directory, 'events.json');
    await writeFile(file, '[]');
    return {
      repo: createLocalRepository(directory),
      seedLegacy: async (stored) => {
        const docs = JSON.parse(await readFile(file, 'utf8'));
        docs.push(stored);
        await writeFile(file, JSON.stringify(docs));
      },
      close: () => rm(directory, { recursive: true, force: true }),
    };
  }
  const db = new PGlite();
  await db.exec(
    'CREATE TABLE bridge_events (id text PRIMARY KEY, revision integer NOT NULL CHECK (revision > 0), document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())',
  );
  // Execute the adapter's actual parameterized SQL in PostgreSQL, not a mocked query matcher.
  const sql: Sql = async (strings, ...values) =>
    (
      await db.query(
        strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, ''),
        values,
      )
    ).rows as Record<string, unknown>[];
  return {
    repo: createNeonRepository(sql),
    seedLegacy: async (stored) => {
      await db.query('INSERT INTO bridge_events(id,revision,document) VALUES ($1,$2,$3::jsonb)', [
        stored.event.id,
        stored.event.revision,
        JSON.stringify(stored),
      ]);
    },
    close: () => db.close(),
  };
}

for (const kind of ['local', 'postgres'] as const)
  test(`${kind} repository contract`, async (t) => {
    const { repo, seedLegacy, close } = await harness(kind);
    try {
      await t.test('stage archive persists in indexes, hides only the selected stage and restores without data loss', async () => {
        const root = await repo.insertCompetition(createCompetition({name:'Stage archive test',venue:'Hall'}));
        const e = stage();
        await repo.insertStage(root.competition.id,e,root.competition.revision);
        const other = stage();
        const c = await repo.getCompetition(root.competition.id);
        await repo.insertStage(root.competition.id,other,c.competition.revision);
        const before = await repo.getEvent(e.id);
        const cmd = command({action:'stage-archive',archived:true},before.event.revision);
        assert.equal(canMutate('admin',cmd),false);
        assert.equal(canMutate('director',cmd),true);
        await repo.mutateEvent(e.id,cmd);
        const archived = await repo.getEvent(e.id);
        assert.equal(archived.event.stageArchived,true);
        assert.deepEqual(archived.event.results,before.event.results);
        assert.deepEqual(archived.event.assignments,before.event.assignments);
        const indexes = await repo.listEventIndex();
        const records = await repo.listCompetitionRecords();
        assert.equal(indexes.find(x=>x.event.id===e.id)?.event.stageArchived,true);
        assert.ok(!competitionCatalog(indexes,records,false).flatMap(c=>c.stages).some(s=>s.id===e.id));
        assert.ok(competitionCatalog(indexes,records,false).flatMap(c=>c.stages).some(s=>s.id===other.id));
        assert.ok(competitionCatalog(indexes,records,true).flatMap(c=>c.stages).some(s=>s.id===e.id));
        await repo.mutateEvent(e.id,command({action:'stage-archive',archived:false},archived.event.revision));
        assert.equal((await repo.getEvent(e.id)).event.stageArchived,false);
      });
      await t.test('archive persists across repositories, inherits to stages and survives metadata edits', async () => {
        const root = await repo.insertCompetition(createCompetition({name:'Archive test',venue:'Hall'}));
        const e = stage();
        await repo.insertStage(root.competition.id,e,root.competition.revision);
        const before = await repo.getEvent(e.id);
        let c = (await repo.getCompetition(root.competition.id)).competition;
        const input = {name:c.name,prefix:c.prefix,venue:c.venue,revision:c.revision,requestId:randomUUID(),archived:true};
        await repo.mutateCompetition(c.id,input);
        assert.equal((await repo.getEvent(e.id)).event.competition?.archived,true);
        c = (await repo.getCompetition(c.id)).competition;
        await repo.mutateCompetition(c.id,{name:'Renamed archive',prefix:c.prefix,venue:c.venue,revision:c.revision,requestId:randomUUID()});
        assert.equal((await repo.getCompetition(c.id)).competition.archived,true);
        c = (await repo.getCompetition(c.id)).competition;
        await repo.mutateCompetition(c.id,{...input,revision:c.revision,requestId:randomUUID(),archived:false});
        const after = await repo.getEvent(e.id);
        assert.equal(after.event.competition?.archived,false);
        assert.deepEqual(after.event.results,before.event.results);
        assert.deepEqual(after.event.assignments,before.event.assignments);
        assert.equal(after.event.revision,before.event.revision);
      });
      await t.test(
        'score, audit and projection commit together; duplicate requests do not commit twice',
        async () => {
          const e = stage();
          await repo.insertEvent(e);
          const a = e.assignments[0];
          const c = command({
            action: 'results',
            results: [
              {
                assignmentId: a.id,
                board: a.boards[0],
                level: 3,
                strain: 'NT',
                declarer: 'N',
                doubled: 1,
                tricks: 9,
                lead: '',
              },
            ],
          });
          await repo.mutateEvent(e.id, c);
          await repo.mutateEvent(e.id, c);
          const saved = await repo.getEvent(e.id);
          assert.equal(saved.event.revision, 2);
          assert.equal(saved.event.audit.length, 2);
          assert.equal(saved.requests.filter((id) => id === c.requestId).length, 1);
          assert.equal(saved.event.results[resultKey(a.id, a.boards[0])].nsScore, 400);
          assert.deepEqual(saved.projection, plain(project(saved.event)));
        },
      );
      await t.test('competing writes produce one commit and one conflict', async () => {
        const e = stage();
        await repo.insertEvent(e);
        const writes = await Promise.allSettled([
          repo.mutateEvent(e.id, command({ amount: 2 })),
          repo.mutateEvent(e.id, command({ amount: 3 })),
        ]);
        assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(writes.filter((r) => r.status === 'rejected' && conflict(r.reason)).length, 1);
        assert.equal((await repo.getEvent(e.id)).event.revision, 2);
      });
      await t.test('failed batch cannot persist partial results or an audit record', async () => {
        const e = stage();
        await repo.insertEvent(e);
        const before = await repo.getEvent(e.id),
          a = e.assignments[0];
        await assert.rejects(
          repo.mutateEvent(
            e.id,
            command({
              action: 'results',
              results: [
                {
                  assignmentId: a.id,
                  board: 1,
                  level: 1,
                  strain: 'NT',
                  doubled: 1,
                  declarer: 'N',
                  tricks: 7,
                  lead: '',
                },
                {
                  assignmentId: 'missing',
                  board: 1,
                  level: 1,
                  strain: 'NT',
                  doubled: 1,
                  declarer: 'N',
                  tricks: 7,
                  lead: '',
                },
              ],
            }),
          ),
        );
        assert.deepEqual(await repo.getEvent(e.id), before);
      });
      await t.test(
        'empty competition, inherited venue, override, stale deletion and last-stage deletion',
        async () => {
          const c = createCompetition({ name: '空賽事測試', venue: '共用場地' });
          await repo.insertCompetition(c);
          const e = stage();
          e.venueOverride = '獨立場地';
          await repo.insertStage(c.competition.id, e, 1);
          assert.equal((await repo.getEvent(e.id)).event.venue, '獨立場地');
          await repo.mutateEvent(
            e.id,
            command({ action: 'settings', status: 'live', venueOverride: null }),
          );
          assert.equal((await repo.getEvent(e.id)).event.venue, '共用場地');
          await assert.rejects(repo.deleteEvent(e.id, 1), conflict);
          await repo.deleteEvent(e.id, 2);
          assert.equal(
            (await repo.getCompetition(c.competition.id)).competition.name,
            '空賽事測試',
          );
          assert.ok(!(await repo.listEvents()).some((s) => s.event.id === e.id));
          const current = await repo.getCompetition(c.competition.id);
          assert.equal(
            await repo.deleteCompetitions({
              competitions: [
                {
                  id: c.competition.id,
                  revision: current.competition.revision,
                  confirmName: '空賽事測試',
                  stages: [],
                },
              ],
            }),
            1,
          );
          await assert.rejects(repo.getCompetition(c.competition.id));
        },
      );
      await t.test('family writes serialize by competition revision', async () => {
        const c = createCompetition({ name: '併發賽段測試' });
        await repo.insertCompetition(c);
        const writes = await Promise.allSettled([
          repo.insertStage(c.competition.id, stage(), 1),
          repo.insertStage(c.competition.id, stage(), 1),
        ]);
        assert.equal(writes.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(writes.filter((r) => r.status === 'rejected' && conflict(r.reason)).length, 1);
        assert.equal(
          (await repo.listEvents()).filter((s) => s.event.parentEventId === c.competition.id)
            .length,
          1,
        );
      });
      await t.test(
        'legacy metadata extraction preserves stage identity, results and device hashes',
        async () => {
          const e = stage();
          e.club = {
            enabled: true,
            mode: 'table',
            tokens: { fixture: 'not-a-real-credential' },
            confirmations: {},
            finalized: [],
          };
          const stored = { event: e, requests: [], projection: project(e) };
          await seedLegacy(stored);
          const update = {
            name: '獨立賽事名稱',
            prefix: '新前綴',
            venue: '新地點',
            revision: 1,
            requestId: randomUUID(),
          };
          await repo.mutateCompetition(e.id, update);
          await repo.mutateCompetition(e.id, update);
          const saved = await repo.getEvent(e.id);
          assert.equal(saved.event.id, e.id);
          assert.equal(saved.event.revision, 2);
          assert.deepEqual(saved.event.results, e.results);
          assert.deepEqual(saved.event.club, e.club);
          assert.equal(saved.event.venue, '新地點');
          assert.equal(saved.event.competition?.name, '獨立賽事名稱');
          await assert.rejects(repo.mutateEvent(e.id, command({})), conflict);
        },
      );
      await t.test(
        'catalog reads expose only stage summaries and keep metadata separate',
        async () => {
          const e = stage();
          await repo.insertEvent(e);
          const index = (await repo.listEventIndex()).find((s) => s.event.id === e.id)!;
          assert.ok(!('results' in index.event));
          assert.ok(!('audit' in index.event));
          assert.ok(!('club' in index.event));
          assert.ok((await repo.listCompetitionRecords()).some((c) => c.competition.id === e.id));
        },
      );
    } finally {
      await close();
    }
  });

test('demo repository remains read-only', async () => {
  const repo = createDemoRepository(),
    e = (await repo.listEvents())[0];
  assert.ok((await repo.getEvent(e.event.id)).event.demo);
  await assert.rejects(
    repo.mutateEvent(e.event.id, command({})),
    (e) => e instanceof DomainError && e.status === 503,
  );
});
