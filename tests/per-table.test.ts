import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Session } from 'node:inspector/promises';
import { findCompetition } from '../lib/competition-record';
import { project } from '../lib/scoring';
import { audienceEvent, audienceScoring } from '../lib/read-models/public-event';
import { hydrateEvent } from '../lib/storage/hydrate-event';
import { migratePerTable } from '../lib/storage/migrate-per-table';
import { saveCompetition } from '../lib/storage/rows';
import { clubConfirmationKey, clubReviewVersion } from '../lib/club-confirmation';
import { clubView } from '../lib/club-view';
import { createEvent } from '../lib/domain/event-factory';
import { mutationSchema, type Assignment, type Mutation } from '../lib/model';
import { createNormalizedRepository, readAdmin, readAdminAudit, readScoreboard } from '../lib/storage/normalized';
import type { Sql } from '../lib/storage/neon';
import { mergeEventProgress } from '../lib/round-progress';
import { readClubStatus } from '../lib/storage/club-status';
import { readProgress } from '../lib/storage/progress';
import { cachedProjection } from '../lib/storage/projection';
import { pollTablet, submitTablet } from '../lib/storage/tablet';
import { createTestDb } from './helpers/sql';

function fixture(boardsPerRound = 1) {
  const event = createEvent({ name: 'Tablet fixture', kind: 'pairs',
    names: ['A', 'B', 'C', 'D'], date: '2026-11-28', venue: '', rounds: 2, boardsPerRound });
  event.currentRound = 1;
  event.roundPhase = 'playing';
  event.club = { enabled: true, tokens: Object.fromEntries(event.participants.map(p => [p.id, p.id])),
    confirmations: {}, finalized: [] };
  return event;
}

const play = (a: Assignment): Extract<Mutation, { action: 'club-play' }> => ({
  action: 'club-play', revision: 0, requestId: randomUUID(), reason: '平板輸入', tokenHash: a.ns, confirm: false, round: 1,
  result: { assignmentId: a.id, board: a.boards[0], level: 1, strain: 'NT', declarer: 'N', tricks: 7, doubled: 1, lead: '' },
});

async function projectionCalls(session: Session) {
  const { result } = await session.post('Profiler.takePreciseCoverage');
  return result.flatMap(script => script.url.endsWith('/lib/scoring.ts') ? script.functions : [])
    // tsx also names its short CommonJS export getter 'project'. Match the function body.
    .filter(fn => fn.functionName === 'project' &&
      fn.ranges[0].endOffset - fn.ranges[0].startOffset === project.toString().length)
    .reduce((n, fn) => n + fn.ranges[0].count, 0);
}

test('per-table storage', async t => {
  const db = await createTestDb();
  t.after(db.close);
  const statements: string[] = [];
  const batches: string[][] = [];
  const sql: Sql = (strings, ...values) => {
    statements.push(strings.join('?'));
    return db.sql(strings, ...values);
  };
  sql.transaction = queries => {
    batches.push(queries.map(q => q.text));
    return db.sql.transaction!(queries);
  };
  const repo = createNormalizedRepository(sql);
  const event = fixture(), id = event.id;
  const initial = await repo.insertEvent(event);
  const [a,b] = event.assignments.filter(a => a.round === 1);
  const poll = (version: string | null = null) => pollTablet(sql, id, a.ns, version, false);
  const view = await poll();
  assert.ok('v' in view);

  await t.test('changed poll restricts assignments, boards and results', () => {
    const reads = statements.slice(-7);
    assert.match(reads.join(' '), /round IN/);
    assert.match(reads.join(' '), /board_number IN/);
    assert.match(reads.join(' '), /FROM bridge_results WHERE event_id = \? AND assignment_id = \?/);
    assert.doesNotMatch(reads.join(' '), /bridge_(audit|requests|organizers)/);
  });
  await t.test('narrow view matches full clubView', () => {
    const { v, ...body } = view;
    assert.deepEqual(body, clubView(event, a.ns));
  });
  await t.test('unchanged poll reads only scalar columns in one statement', async () => {
    statements.length = 0;
    assert.deepEqual(await poll(view.v!), { unchanged: true });
    assert.equal(statements.length, 1);
    assert.doesNotMatch(statements[0], /settings|document|bridge_(participants|results|boards|audit|requests)/);
  });
  await t.test('simultaneous independent score submits commit without retries', async () => {
    batches.length = 0;
    await Promise.all([a,b].map(row => submitTablet(sql, id, play(row), false)));
    assert.equal(batches.length, 2);
    assert.equal(Object.keys((await repo.getEvent(id)).event.results).length, 2);
  });
  await t.test('a score writes one cell, assignment version, audit and request', async () => {
    batches.length = 0;
    const command = play(a);
    await submitTablet(sql, id, command, false);
    await submitTablet(sql, id, command, false, '');
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].slice(1).map(q => q.match(/(?:UPDATE|INSERT INTO) (bridge_\w+)/)?.[1]),
      ['bridge_assignments','bridge_results','bridge_requests','bridge_audit']);
  });
  await t.test('tablet guard checks both observed versions without changing the stage', () => {
    assert.match(batches[0][1], /AND version = \$\d+[\s\S]*SELECT revision FROM bridge_stages/);
    assert.doesNotMatch(batches[0].join(' '), /UPDATE bridge_stages|FOR UPDATE/);
  });
  await t.test('director and tablet on different assignments both succeed', async () => {
    const before = (await repo.getEvent(id)).event;
    const command = mutationSchema.parse({ action: 'results', requestId: randomUUID(), revision: before.revision,
      results: [{ ...play(b).result, tricks: 8 }] });
    await Promise.all([repo.mutateEvent(id, command), submitTablet(sql, id, play(a), false)]);
    assert.equal((await repo.getEvent(id)).event.results[`${b.id}:${b.boards[0]}`].tricks, 8);
  });
  await t.test('simultaneous last confirmations settle exactly once', async () => {
    const before = (await repo.getEvent(id)).event;
    batches.length = 0;
    await Promise.all([a,b].map(row => submitTablet(sql, id, {
      ...play(row), tokenHash: row.ew, confirm: true, result: undefined, reviewVersion: clubReviewVersion(before, row),
    }, false)));
    const after = (await repo.getEvent(id)).event;
    assert.equal(batches.filter(batch => batch.some(q => q.includes('WITH published AS'))).length, 1);
    assert.deepEqual(after.club?.finalized, [1]);
    assert.equal(after.roundPhase, 'break');
    assert.equal(after.audit.filter(entry => entry.action === '圈次結算').length, 1);
  });
  await t.test('confirmation writes its assignment, audit and request', () => {
    const confirm = batches.find(batch => batch[1]?.includes('SET confirmation'))!;
    assert.deepEqual(confirm.slice(1).flatMap(q => q.match(/(?:UPDATE|INSERT INTO) (bridge_\w+)/)?.slice(1) ?? []),
      ['bridge_assignments','bridge_requests','bridge_audit']);
  });
  await t.test('admin reuses its full projection and validates with one scalar query', async () => {
    const before = (await repo.getEvent(id)).event;
    const first = await cachedProjection(sql, before);
    statements.length = 0;
    assert.deepEqual(await cachedProjection(sql, before), first);
    assert.equal(statements.length, 1);
    assert.match(statements[0], /bridge_projection_cache/);
    const adminTag = `"${before.revision}.${before.competition!.revision}"`;
    statements.length = 0;
    const unchanged = await readAdmin(sql, id, adminTag, true);
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.headers.get('etag'), adminTag);
    assert.equal(statements.length, 1);
    assert.doesNotMatch(statements[0], /settings|document|projection/);
    statements.length = batches.length = 0;
    const admin = await (await readAdmin(sql, id, null, true)).json();
    assert.ok(!('audit' in admin) && !('requests' in admin));
    assert.doesNotMatch([...statements, ...batches.flat()].join(' '), /bridge_(competition_)?(audit|requests)/);
    assert.deepEqual(await readAdminAudit(sql, id), [...before.audit].reverse());
  });
  await t.test('club status validates once and returns receipts and acceptance for current and unfinalized rounds', async () => {
    const e = fixture();
    const [early, current] = [e.assignments[0], e.assignments.find(a => a.round === 2)!];
    e.assignments.push({ ...early, id: 'finalized', round: 3 }, { ...current, id: 'future', round: 5 });
    current.round = e.currentRound = 4;
    e.rounds = 5;
    e.club!.finalized = [3];
    e.results[`${early.id}:${early.boards[0]}`] = { ...play(early).result!, nsScore: 90, updatedAt: e.updatedAt };
    e.club!.confirmations[clubConfirmationKey(e, early)] = { at: e.updatedAt, forced: false, reviewVersion: clubReviewVersion(e, early) };
    const { event: saved } = await repo.insertEvent(e);
    const first = await readClubStatus(sql, e.id, null);
    const body = await first.json();
    assert.deepEqual([body.currentRound, body.finalized, body.stageRevision], [4, [3], saved.revision]);
    assert.deepEqual(Object.keys(body.assignments).sort(), e.assignments.filter(a => a.round <= 4 && a.round !== 3).map(a => a.id).sort());
    assert.deepEqual(body.assignments[early.id], { version: saved.revision, boards: early.boards, confirmed: true, accepted: true });
    assert.deepEqual(body.assignments[current.id], { version: saved.revision, boards: [], confirmed: false, accepted: false });
    statements.length = 0;
    const tag = first.headers.get('etag');
    assert.equal((await readClubStatus(sql, e.id, tag)).status, 304);
    assert.equal(statements.length, 1);
    await repo.mutateEvent(e.id, mutationSchema.parse({ action: 'results', requestId: randomUUID(), revision: saved.revision,
      results: [{ ...play(early).result, tricks: 8 }] }));
    const update = await readClubStatus(sql, e.id, tag);
    assert.equal(update.status, 200);
    const changed = await update.json();
    assert.equal(changed.stageRevision, body.stageRevision);
    assert.deepEqual(changed.assignments[early.id], { version: changed.revision, boards: early.boards, confirmed: true, accepted: false });
  });
  await t.test('scoreboard reads the published snapshot and validates with one scalar query', async () => {
    statements.length = 0;
    const changed = await readScoreboard(sql, id, null, false);
    assert.equal(statements.length, 2);
    assert.doesNotMatch(statements.join(' '), /bridge_(assignments|participants|boards|results|penalties|requests|audit)/);
    const { enteredBoards, collectionProgress, receivedByParticipant, ...expected } = audienceEvent((await repo.getEvent(id)).event);
    assert.deepEqual(await changed.json(), JSON.parse(JSON.stringify(expected)));
    const etag = changed.headers.get('etag');
    statements.length = 0;
    const response = await readScoreboard(sql, id, etag, false);
    assert.equal(response.status, 304);
    assert.equal(response.headers.get('etag'), etag);
    assert.equal(response.headers.get('cache-control'), 'private, no-cache');
    assert.equal(statements.length, 1);
    assert.doesNotMatch(statements[0], /document|settings/);
    const published = await repo.mutateEvent(id, mutationSchema.parse({ action: 'board-publication',
      board: a.boards[0], published: true, reason: '公開已結算成績', revision: expected.revision, requestId: randomUUID() }));
    const release = await readScoreboard(sql, id, etag, false);
    assert.equal((await release.json()).results[`${a.id}:${a.boards[0]}`].tricks, 7);
    await repo.mutateEvent(id, mutationSchema.parse({ action: 'results', results: [{ ...play(a).result, tricks: 9 }],
      revision: published.event.revision, requestId: randomUUID() }));
    const corrected = await readScoreboard(sql, id, release.headers.get('etag'), false);
    assert.equal((await corrected.json()).results[`${a.id}:${a.boards[0]}`].tricks, 9);
  });
  await t.test('only settlement computes standings when tablets and directors write an open round', async () => {
    const e = fixture();
    e.boards[0].published = true;
    await repo.insertEvent(e);
    const tag = (await readScoreboard(sql, e.id, null, false)).headers.get('etag');
    const [first, second] = e.assignments.filter(a => a.round === 1);
    await submitTablet(sql, e.id, play(second), false);
    const session = new Session();
    session.connect();
    try {
      await session.post('Profiler.enable');
      await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
      await submitTablet(sql, e.id, play(first), false);
      assert.equal(await projectionCalls(session), 0);
      const correction = await repo.mutateEvent(e.id, mutationSchema.parse({ action: 'results', requestId: randomUUID(),
        revision: (await repo.getEvent(e.id, false, false)).event.revision,
        results: [{ ...play(second).result, tricks: 8 }] }));
      assert.equal(await projectionCalls(session), 0);
      const confirm = (row: Assignment) => submitTablet(sql, e.id, { ...play(row), tokenHash: row.ew, confirm: true,
        result: undefined, reviewVersion: clubReviewVersion(correction.event, row) }, false);
      await confirm(first);
      assert.equal(await projectionCalls(session), 0);
      assert.equal((await readScoreboard(sql, e.id, tag, false)).status, 304);
      await confirm(second);
      assert.equal(await projectionCalls(session), 1);
      const settled = await readScoreboard(sql, e.id, tag, false);
      assert.equal(Object.keys((await settled.json()).results).length, 2);
    } finally {
      session.disconnect();
    }
  });
  await t.test('running scores publish comparable results on a director refresh', async () => {
    const e = fixture(3);
    for (const board of e.boards) board.published = true;
    await repo.insertEvent(e);
    const tables = e.assignments.filter(a => a.round === 1);
    const [first] = tables;
    const initialTag = (await readScoreboard(sql, e.id, null, false)).headers.get('etag');
    const partial = play(first);
    await submitTablet(sql, e.id, { ...partial, result: { ...partial.result!, board: first.boards[2] } }, false);
    const midRound = (await repo.getEvent(e.id, false, false)).event;
    assert.deepEqual([midRound.club?.runningScore, audienceScoring(midRound).results], [undefined, {}]);
    assert.equal((await readScoreboard(sql, e.id, initialTag, false)).status, 304);

    const session = new Session();
    session.connect();
    try {
      await session.post('Profiler.enable');
      await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
      async function publish(input: { action: 'club-config'; enabled: boolean; runningScore: boolean } |
        { action: 'running-score-refresh' }, tag: string | null) {
        const { event } = await repo.getEvent(e.id, false, false);
        batches.length = 0;
        await repo.mutateEvent(e.id, mutationSchema.parse({
          ...input, revision: event.revision, requestId: randomUUID(), reason: '測試更新公開成績',
        }));
        assert.equal(await projectionCalls(session), 1);
        assert.equal(batches.flat().filter(q => q.includes('WITH published AS')).length, 1);
        const response = await readScoreboard(sql, e.id, tag, false);
        assert.equal(response.status, 200);
        assert.notEqual(response.headers.get('etag'), tag);
        return response;
      }

      const enabled = await publish({ action: 'club-config', enabled: true, runningScore: true }, initialTag);
      assert.equal((await repo.getEvent(e.id, false, false)).event.club?.runningScore, true);
      const oldTag = enabled.headers.get('etag');
      const keys = [];
      for (const row of tables) {
        for (const board of row.boards.slice(0, 2)) {
          const command = play(row);
          await submitTablet(sql, e.id, { ...command, result: { ...command.result!, board } }, false);
          keys.push(`${row.id}:${board}`);
        }
      }
      assert.equal(await projectionCalls(session), 0);
      assert.equal((await readScoreboard(sql, e.id, oldTag, false)).status, 304);

      const refreshed = await publish({ action: 'running-score-refresh' }, oldTag);
      const snapshot = await refreshed.json();
      assert.deepEqual(Object.keys(snapshot.results).sort(), keys.sort());
      assert.deepEqual(snapshot.projection.standings.map((row: { played: number }) => row.played), [2, 2, 2, 2]);
      assert.equal(snapshot.boards[0].published, false);
      assert.equal(snapshot.clubEnabled, true);
      assert.equal(snapshot.club, undefined);
      assert.equal(snapshot.runningScore, undefined);
      const newTag = refreshed.headers.get('etag');
      assert.equal((await readScoreboard(sql, e.id, newTag, false)).status, 304);

      const disabled = await publish({ action: 'club-config', enabled: true, runningScore: false }, newTag);
      assert.deepEqual((await disabled.json()).results, {});
    } finally {
      session.disconnect();
    }
  });
  await t.test('different penalty rows accept the same client revision and stale same-row writes conflict', async () => {
    const penalty = (participantId: string, amount: number) => mutationSchema.parse({ action: 'penalty', reason: '測試判罰',
      participantId, amount, requestId: randomUUID(), revision: initial.event.revision });
    await Promise.all([repo.mutateEvent(id, penalty(a.ns, 2)), repo.mutateEvent(id, penalty(b.ns, 3))]);
    await assert.rejects(repo.mutateEvent(id, penalty(a.ns, 4)), { status: 409 });
  });
  await t.test('director writes the changed penalty, public snapshot, audit and request', async () => {
    batches.length = 0;
    await repo.mutateEvent(id, mutationSchema.parse({ action: 'penalty', reason: '測試判罰', participantId: a.ns, amount: 5,
      requestId: randomUUID(), revision: (await repo.getEvent(id)).event.revision }));
    const writes = batches.at(-1)!.filter(q => /INSERT INTO|UPDATE bridge_|DELETE FROM/.test(q));
    assert.ok(writes.some(q => q.includes('INSERT INTO bridge_projection_cache')));
    assert.deepEqual(writes.map(q => q.match(/(?:INSERT INTO|UPDATE) (bridge_\w+)/)?.[1]), ['bridge_penalties','bridge_stages','bridge_audit','bridge_requests']);
  });
  await t.test('ordinary writes keep unrelated rows in place', async () => {
    const query = () => db.sql`SELECT xmin::text, document_json FROM bridge_boards WHERE event_id = ${id} ORDER BY ordinal`;
    const before = await query();
    const current = await repo.getEvent(id);
    await repo.mutateEvent(id, mutationSchema.parse({ action: 'stage-archive', reason: '測試封存', archived: true,
      revision: current.event.revision, requestId: randomUUID() }));
    assert.deepEqual(await query(), before);
  });
  await t.test('single-stage and competition operations scope their family reads in SQL', async () => {
    statements.length = 0;
    batches.length = 0;
    await repo.getEvent(id);
    const root = (await repo.getCompetition(id)).competition;
    const child = await repo.insertStage(id, fixture(), root.revision);
    await repo.mutateCompetition(id, { name: root.name, venue: 'Club', revision: (await repo.getCompetition(id)).competition.revision, requestId: randomUUID() });
    await repo.deleteEvent(child.event.id, child.event.revision);
    assert.ok(statements.some(q => q.includes('FROM bridge_competitions WHERE id = ?')));
    assert.doesNotMatch([...statements, ...batches.flat()].join(' '), /FROM bridge_(competitions|stages) ORDER BY/);
  });
});

test('migration preserves fifteen board documents, scores, audit, tokens, confirmations and views', async t => {
  const { sql, close } = await createTestDb(false);
  t.after(close);
  const event = createEvent({ name: 'Migration fixture', kind: 'pairs', date: '2026-11-28', venue: 'Club',
    names: ['A','B','C','D','E','F'], rounds: 5, boardsPerRound: 3 });
  const id = event.id, a = event.assignments[0];
  event.currentRound = 1;
  event.club = { enabled: true, tokens: { [a.ns]: 'hash' }, confirmations: {}, finalized: [] };
  event.penalties = { [a.ns]: 2 };
  for (const board of a.boards) event.results[`${a.id}:${board}`] = { ...play(a).result!, board, nsScore: 90, updatedAt: event.updatedAt };
  event.club.confirmations[clubConfirmationKey(event, a)] = { at: event.updatedAt, forced: false, reviewVersion: clubReviewVersion(event, a) };
  const { boards, results, assignments, participants, penalties, audit, ...settings } = event;
  assert.equal(boards.length, 15);
  await sql`INSERT INTO bridge_stages(id,revision,competition_id,settings,projection) VALUES
    (${id},${event.revision},${id},${JSON.stringify(settings)}::jsonb,${JSON.stringify(project(event))}::jsonb)`;
  for (const [i,b] of boards.entries()) await sql`INSERT INTO bridge_boards VALUES (${id},${b.number},${i},${JSON.stringify(b, null, 1)})`;
  for (const [i,row] of assignments.entries()) await sql`INSERT INTO bridge_assignments VALUES (${id},${row.id},${i},${JSON.stringify(row)}::jsonb)`;
  for (const [i,p] of participants.entries()) await sql`INSERT INTO bridge_participants VALUES (${id},${p.id},${i},${JSON.stringify(p)}::jsonb)`;
  for (const result of Object.values(results)) await sql`INSERT INTO bridge_results VALUES
    (${id},${a.id},${result.board},1,1,${JSON.stringify(result)}::jsonb)`;
  for (const [i,row] of audit.entries()) await sql`INSERT INTO bridge_audit VALUES (${id},${i},${JSON.stringify(row)}::jsonb)`;
  await sql`INSERT INTO bridge_penalties VALUES (${id},${a.ns},${JSON.stringify(penalties[a.ns])}::jsonb)`;
  await sql`INSERT INTO bridge_requests(event_id,request_id) VALUES (${id},'first')`;
  const snapshot = () => Promise.all([sql`SELECT * FROM bridge_boards ORDER BY ordinal`, sql`SELECT event_id,assignment_id,board,revision,written_at_event_revision,document FROM bridge_results ORDER BY board`,
    sql`SELECT * FROM bridge_audit ORDER BY seq`, sql`SELECT * FROM bridge_requests`, sql`SELECT settings FROM bridge_stages`]);
  const before = await snapshot();
  const full = project(event);
  const root = findCompetition([{event, requests: ['first'], projection: full}], id);
  await saveCompetition(sql, root);
  const legacy = hydrateEvent({ event: JSON.parse(JSON.stringify(event)), requests: ['first'], projection: full }, root.competition);
  const expected = [{ stage: id, assignments: assignments.length, tokens: 1, confirmations: 1 }];
  assert.deepEqual(await migratePerTable(sql, false), expected);
  assert.deepEqual(await sql`SELECT to_regclass('bridge_club_tokens') AS name`, [{ name: null }]);
  assert.deepEqual(await migratePerTable(sql, true), expected);
  assert.deepEqual(await migratePerTable(sql, true), []);
  assert.deepEqual(await snapshot(), before);
  const repo = createNormalizedRepository(sql);
  const migrated = await repo.getEvent(id);
  assert.ok(migrated.event.revision > event.revision);
  const { revision: _new, ...newEvent } = migrated.event, { revision: _old, ...legacyEvent } = legacy.event;
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(newEvent), plain(legacyEvent));
  assert.deepEqual(migrated.requests, legacy.requests);
  const poll = await pollTablet(sql, id, 'hash', null, false);
  assert.ok('v' in poll);
  const { v: _v, ...view } = poll;
  assert.deepEqual(plain(view), plain(clubView(legacy.event, a.ns)));
  const publicView = await (await readScoreboard(sql, id, null, false)).json();
  const progress = await (await readProgress(sql, id, null, false)).json();
  assert.deepEqual(plain({ ...mergeEventProgress(publicView, progress), revision: legacy.event.revision }), plain(audienceEvent(legacy.event, full)));
});
