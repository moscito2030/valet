import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as statusRoute from '../app/api/agent/events/[eventId]/status/route';
import * as previewRoute from '../app/api/agent/events/[eventId]/preview/route';
import * as mutationRoute from '../app/api/agent/events/[eventId]/mutations/route';
import { issueCode } from '../lib/access/codes';
import { valetMcpTools } from '../lib/agent/mcp';
import { agentRoute } from '../lib/agent/routes';
import { createEvent } from '../lib/domain/event-factory';
import { createNeonRepository } from '../lib/storage/neon';
import { createTestDb } from './helpers/sql';

type Operation = 'status' | 'preview' | 'mutations';

const operations = { status: statusRoute, preview: previewRoute, mutations: mutationRoute };
const spec = JSON.parse(readFileSync('docs/agent-api.openapi.yaml', 'utf8'));
const observed = new Map<Operation, Set<string>>();

async function fixture(mode: 'legacy' | 'normalized' = 'normalized') {
  const { sql, db, close } = await createTestDb();
  await sql`CREATE TABLE bridge_login_limits (key text PRIMARY KEY, attempts integer NOT NULL, window_end timestamptz NOT NULL)`;
  if (mode === 'normalized')
    await sql`UPDATE bridge_storage_switch SET mode = 'normalized', legacy_watermark = '1970-01-01T00:00:00.000Z' WHERE id = 1`;
  const repo = createNeonRepository(sql);
  const event = createEvent({
    name: '代理路由', date: '2026-11-20', venue: '測試', kind: 'pairs',
    names: ['甲', '乙', '丙', '丁'], rounds: 1, boardsPerRound: 1,
  });
  event.organizerId = 'fixture-organizer';
  event.currentRound = 1;
  event.boards[0].published = true;
  await repo.insertEvent(event);
  async function code(role: 'referee' | 'scoring' | 'read' = 'scoring', overrides = {}) {
    const issued = issueCode('bootstrap', {
      name: '代理測試', scope: 'event', eventId: event.id,
      organizerId: event.organizerId, role, createdAt: event.updatedAt, expiresAt: null,
      ...overrides,
    });
    await sql`INSERT INTO bridge_access_codes (id, document) VALUES (${issued.code.id}, ${JSON.stringify(issued.code)}::jsonb)`;
    return issued;
  }
  const { secret, code: actor } = await code('referee');
  const revoked = issueCode('bootstrap', { name: '已撤銷', scope: 'event', role: 'referee', eventId: event.id, createdAt: event.updatedAt, expiresAt: null });
  revoked.code.revokedAt = event.updatedAt;
  await sql`INSERT INTO bridge_access_codes (id, document) VALUES (${revoked.code.id}, ${JSON.stringify(revoked.code)}::jsonb)`;

  type RequestOptions = { secret?: string | null; body?: object; key?: string; id?: string; ip?: string };
  async function call(operation: Operation, { secret: token = secret, body, key, id = event.id, ip = '192.0.2.1' }: RequestOptions = {}) {
    const method = operation === 'status' ? 'GET' : 'POST';
    const headers = new Headers({ 'x-forwarded-for': ip });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (key) headers.set('Idempotency-Key', key);
    const request = new Request(`http://localhost/api/agent/events/${id}/${operation}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await agentRoute(operation, request, id, { sql, sessionSecret: 'fixture-session-secret' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (!observed.has(operation)) observed.set(operation, new Set());
    observed.get(operation)!.add(String(response.status));
    return { status: response.status, data: await response.json(), headers: response.headers };
  }

  function score(revision = event.revision) {
    const requestId = randomUUID();
    return { requestId, command: {
      action: 'results', revision, requestId,
      results: [{ assignmentId: event.assignments[0].id, board: 1, level: 1, strain: 'NT', doubled: 1, declarer: 'N', tricks: 7 }],
    } };
  }
  return { sql, db, close, repo, event, code, actor, revoked, call, score };
}

function expectError(response: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['call']>>, status: number, code: string) {
  assert.equal(response.status, status, JSON.stringify(response.data));
  assert.equal(response.data.code, code);
  assert.match(response.data.error, /[\u3400-\u9fff]/);
}

test('agent access codes enforce roles, event and organizer scope, and expiry', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const read = await f.code('read');
  const expired = await f.code('scoring', { expiresAt: '2000-01-01T00:00:00Z' });
  const wrongEvent = await f.code('referee', { eventId: 'another-stage' });
  const wrongOrganizer = await f.code('referee', { organizerId: 'another-organizer' });
  const nonEvent = await f.code('referee', { scope: 'organizer' });
  const absent = await f.code('referee', { eventId: 'absent' });
  const body = f.score();
  expectError(await f.call('status', { secret: null }), 401, 'CODE_UNKNOWN');
  expectError(await f.call('preview', { secret: 'unknown', body }), 401, 'CODE_UNKNOWN');
  expectError(await f.call('mutations', { secret: 'unknown', body, key: 'key' }), 401, 'CODE_UNKNOWN');
  expectError(await f.call('status', { secret: f.revoked.secret }), 403, 'CODE_REVOKED');
  expectError(await f.call('status', { secret: expired.secret }), 403, 'CODE_EXPIRED');
  expectError(await f.call('status', { secret: wrongEvent.secret }), 403, 'FORBIDDEN_SCOPE');
  expectError(await f.call('status', { secret: wrongOrganizer.secret }), 403, 'FORBIDDEN_SCOPE');
  expectError(await f.call('status', { secret: nonEvent.secret }), 403, 'FORBIDDEN_ROLE');
  expectError(await f.call('status', { secret: absent.secret, id: 'absent' }), 404, 'EVENT_NOT_FOUND');
  expectError(await f.call('preview', { secret: absent.secret, id: 'absent', body }), 404, 'EVENT_NOT_FOUND');
  expectError(await f.call('mutations', { secret: absent.secret, id: 'absent', body, key: 'key' }), 404, 'EVENT_NOT_FOUND');
  expectError(await f.call('preview', { secret: read.secret, body }), 403, 'FORBIDDEN_ROLE');
  expectError(await f.call('mutations', { secret: read.secret, body, key: 'key' }), 403, 'FORBIDDEN_ROLE');
  const status = await f.call('status', { secret: read.secret });
  assert.equal(status.status, 200);
  assert.deepEqual(status.data, {
    revision: f.event.revision, currentRound: 1, phase: 'playing', publishedBoards: [1],
    tablesPending: f.event.assignments.map(({ id, round }) => ({ assignmentId: id, round })),
  });
});

test('agent login throttling persists across operations and limits verification by IP', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const expired = await f.code('scoring', { expiresAt: '2000-01-01T00:00:00Z' });
  expectError(await f.call('status', { secret: f.revoked.secret }), 403, 'CODE_REVOKED');
  expectError(await f.call('status', { secret: expired.secret }), 403, 'CODE_EXPIRED');
  for (let i = 0; i < 8; i++)
    expectError(await f.call('status', { secret: 'unknown' }), 401, 'CODE_UNKNOWN');
  const blocked = await f.call('status', { secret: 'unknown' });
  expectError(blocked, 429, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.ok(Number(blocked.headers.get('retry-after')) <= 600);
  expectError(await f.call('preview', { body: f.score() }), 429, 'RATE_LIMITED');
  expectError(await f.call('mutations', { body: f.score(), key: 'key' }), 429, 'RATE_LIMITED');
  assert.equal((await f.call('status', { ip: '192.0.2.2' })).status, 200);
  expectError(await f.call('status'), 429, 'RATE_LIMITED');
  await f.sql`UPDATE bridge_login_limits SET window_end = now() - interval '1 second'`;
  assert.equal((await f.call('status')).status, 200);
});

test('agent mutations require normalized storage while legacy reads and previews remain available', async (t) => {
  const f = await fixture('legacy');
  t.after(f.close);
  const body = f.score();
  assert.equal((await f.call('status')).status, 200);
  assert.equal((await f.call('preview', { body })).status, 200);
  expectError(await f.call('mutations', { body, key: 'key' }), 503, 'AGENT_NORMALIZED_STORAGE_REQUIRED');
  assert.equal((await f.repo.getEvent(f.event.id)).event.revision, f.event.revision);
  assert.deepEqual(await f.sql`SELECT * FROM bridge_agent_mutations`, []);
  assert.deepEqual(await f.sql`SELECT * FROM bridge_access_audit`, []);
  await f.sql`DELETE FROM bridge_storage_switch WHERE id = 1`;
  expectError(await f.call('mutations', { body, key: 'key' }), 503, 'AGENT_NORMALIZED_STORAGE_REQUIRED');
});

test('agent preview and atomic replay preserve normalized board storage', async (t) => {
  const f = await fixture();
  t.after(f.close);
  // Detect a rewrite even if the board values round-trip unchanged.
  await f.sql`UPDATE bridge_boards SET document_json = document_json || ' ' WHERE event_id = ${f.event.id}`;
  const boardSnapshot = () =>
    f.sql`SELECT xmin::text, document_json FROM bridge_boards WHERE event_id = ${f.event.id} ORDER BY ordinal`;
  const boards = await boardSnapshot();
  const body = f.score();
  const { secret } = await f.code();
  const before = await f.repo.getEvent(f.event.id);
  const preview = await f.call('preview', { body, secret });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.alreadyApplied, false);
  assert.equal(preview.data.changes.length, 1);
  assert.deepEqual(await f.repo.getEvent(f.event.id), before);
  assert.deepEqual(await f.sql`SELECT * FROM bridge_access_audit`, []);
  assert.deepEqual(await f.sql`SELECT * FROM bridge_agent_mutations`, []);
  assert.deepEqual(await f.sql`SELECT * FROM bridge_login_limits`, []);
  expectError(await f.call('mutations', { body, secret }), 422, 'INVALID_MUTATION');
  for (const operation of ['preview', 'mutations'] as const) {
    const banned = { ...body, command: { ...body.command, action: 'board-publication', board: 1, published: false } };
    expectError(await f.call(operation, { body: banned, key: 'denied' }), 403, 'FORBIDDEN_ROLE');
  }
  const request = { body, key: 'one', secret };
  const [first, second] = await Promise.all([f.call('mutations', request), f.call('mutations', request)]);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.deepEqual(first.data, { revision: f.event.revision + 1 });
  assert.deepEqual(second.data, first.data);
  const audits = await f.sql`SELECT document FROM bridge_access_audit`;
  assert.equal(audits.length, 1);
  assert.deepEqual((audits[0].document as { viaAgent: boolean }).viaAgent, true);
  assert.deepEqual(await boardSnapshot(), boards);
  assert.equal(Object.keys((await f.repo.getEvent(f.event.id)).event.results).length, 1);
  const latest = f.score(first.data.revision);
  const next = await f.call('mutations', { body: latest, key: 'one' });
  assert.equal(next.status, 200, JSON.stringify(next.data));
  assert.deepEqual((await f.call('mutations', request)).data, first.data);
  expectError(await f.call('mutations', { ...request, body: latest }), 409, 'IDEMPOTENCY_CONFLICT');
  expectError(await f.call('mutations', { ...request, key: 'new' }), 409, 'REQUEST_ID_CONFLICT');
  expectError(await f.call('mutations', { body: f.score(), key: 'stale' }), 409, 'REVISION_CONFLICT');
  expectError(await f.call('preview', { body: f.score() }), 409, 'REVISION_CONFLICT');
  expectError(await f.call('preview', { body: {} }), 422, 'INVALID_MUTATION');
  assert.deepEqual((await f.call('preview', request)).data, { alreadyApplied: true, changes: [] });
  assert.deepEqual(await boardSnapshot(), boards);
  assert.equal((await f.sql`SELECT * FROM bridge_agent_mutations`).length, 2);
  assert.equal((await f.sql`SELECT * FROM bridge_access_audit`).length, 2);
});

test('agent storage errors fail closed and leave scores and audit unchanged', async (t) => {
  const f = await fixture();
  t.after(f.close);
  const body = f.score();
  await f.db.exec('DROP TABLE bridge_access_audit');
  expectError(await f.call('mutations', { body, key: 'key' }), 503, 'AGENT_SCHEMA_MISSING');
  assert.deepEqual(await f.sql`SELECT * FROM bridge_agent_mutations`, []);
  await f.db.exec('DROP TABLE bridge_agent_mutations');
  expectError(await f.call('mutations', { body, key: 'key' }), 503, 'AGENT_SCHEMA_MISSING');
  assert.equal((await f.repo.getEvent(f.event.id)).event.revision, f.event.revision);
  assert.equal((await f.call('preview', { body })).status, 200);
  await f.db.exec('DROP TABLE bridge_access_codes');
  expectError(await f.call('status'), 503, 'AGENT_SCHEMA_MISSING');
  expectError(await f.call('preview', { body }), 503, 'AGENT_SCHEMA_MISSING');
});

test('agent OpenAPI paths, methods and response statuses match the route exports and observed responses', () => {
  assert.deepEqual(Object.keys(spec.paths).sort(), valetMcpTools.map(({ path }) => path).sort());
  for (const { path, method } of valetMcpTools) {
    const operation = path.split('/').at(-1) as Operation;
    assert.equal(typeof (operations[operation] as Record<string, unknown>)[method], 'function');
    assert.deepEqual(Object.keys(spec.paths[path]), [method.toLowerCase()]);
    assert.deepEqual(Object.keys(spec.paths[path][method.toLowerCase()].responses).sort(), [...observed.get(operation)!].sort());
  }
});
