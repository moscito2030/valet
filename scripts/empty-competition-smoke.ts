import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { project } from '../lib/scoring';

// Runs exclusively against an isolated local data directory. Never issues device links.
async function main() {
const directory = await mkdtemp(path.join(tmpdir(), 'valet-empty-competition-'));
const file = path.join(directory, 'events.json');
const makeStage = (name: string) => {
  const event = createEvent({ name, kind: 'pairs', date: '2026-10-18', venue: '舊場地', names: ['甲', '乙', '丙', '丁'], rounds: 1, boardsPerRound: 2 });
  const stored = { event, projection: project(event), requests: [] as string[] };
  const a = event.assignments[0];
  return applyMutation(stored, { action: 'results', revision: 1, requestId: randomUUID(), reason: '測試', results: [{ assignmentId: a.id, board: a.boards[0], level: 1, strain: 'NT', declarer: 'N', doubled: 1, tricks: 7, lead: '' }] });
};
const legacy = makeStage('舊賽事'), sibling = makeStage('舊決賽'), legacyEdit = makeStage('舊單段賽事');
sibling.event.parentEventId = legacy.event.id;
sibling.event.club = { enabled: true, tokens: { p1: 'non-authentic-fixture-hash' }, confirmations: {}, finalized: [] };
await writeFile(file, JSON.stringify([legacy, sibling, legacyEdit]));
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  env: { ...process.env, STORAGE_MODE: 'local', VALET_LOCAL_DATA_DIR: directory, DATABASE_URL: '', VERCEL: '', ADMIN_PASSWORD: 'competition-staff-test-only', DIRECTOR_PASSWORD: 'competition-director-test-only', SESSION_SECRET: 'competition-test-only-session-secret-32chars' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let logs = ''; child.stdout.on('data', b => { logs = (logs + b).slice(-6000); }); child.stderr.on('data', b => { logs = (logs + b).slice(-6000); });
let cookie = '';
async function req(url: string, method = 'GET', body?: unknown, expected = 200, auth = cookie) {
  const response = await fetch(origin + url, { method, headers: { Origin: origin, Cookie: auth, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
  return data;
}
async function login(password: string) {
  const response = await fetch(origin + '/api/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(response.status, 200); return response.headers.get('set-cookie')!.split(';')[0];
}
async function catalog(id: string) { return (await req('/api/competitions')).competitions.find((c: { id: string }) => c.id === id); }
async function removeStage(id: string) {
  const e = await req('/api/admin/events/' + id);
  return req('/api/admin/events/' + id, 'DELETE', { confirmStageName: e.stageName ?? e.name, revision: e.revision });
}
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(ready, logs);
  cookie = await login('competition-director-test-only');
  const staff = await login('competition-staff-test-only');
  await req('/api/competitions', 'POST', { name: '不可建立' }, 401, '');
  await req('/api/competitions', 'POST', { name: '不可建立' }, 403, staff);
  const { id } = await req('/api/competitions', 'POST', { name: '空賽事驗證', prefix: '測試', venue: '總館' }, 201);
  let c = await catalog(id);
  assert.deepEqual(c.stages, []); assert.equal(c.date, '');
  const shared = { name: '空賽事驗證', prefix: '更新', venue: '新總館', revision: c.revision, requestId: randomUUID() };
  await req('/api/competitions/' + id, 'PATCH', shared, 403, staff);
  const changed = await req('/api/competitions/' + id, 'PATCH', shared);
  assert.deepEqual(await req('/api/competitions/' + id, 'PATCH', shared), changed);
  await req('/api/competitions/' + id, 'PATCH', { ...shared, requestId: randomUUID() }, 409);
  c = await catalog(id);
  const stage = { name: '上午場', kind: 'teams', date: '2026-11-01', venue: 'ignored', names: ['A', 'B', 'C'], rounds: 1, boardsPerRound: 2 };
  const first = await req(`/api/competitions/${id}/stages`, 'POST', { stage, revision: c.revision }, 201);
  await req(`/api/competitions/${first.id}/stages`, 'POST', { stage, revision: 1 }, 404);
  await req(`/api/competitions/${id}/stages`, 'POST', { stage, revision: c.revision }, 409);
  c = await catalog(id);
  const second = await req(`/api/competitions/${id}/stages`, 'POST', { stage: { ...stage, name: '下午場', date: '2026-11-03', endDate: '2026-11-04', venueOverride: '分館' }, revision: c.revision }, 201);
  c = await catalog(id);
  assert.equal(c.date, '2026-11-01'); assert.equal(c.endDate, '2026-11-04');
  const before = await req('/api/admin/events/' + first.id);
  await req('/api/competitions/' + id, 'PATCH', { ...shared, venue: '再改總館', revision: c.revision, requestId: randomUUID() });
  const after = await req('/api/admin/events/' + first.id);
  assert.equal(after.venue, '再改總館'); assert.equal(after.revision, before.revision);
  assert.deepEqual(after.assignments, before.assignments);
  let overridden = await req('/api/admin/events/' + second.id);
  assert.equal(overridden.venue, '分館');
  const settings = { action: 'settings', status: 'live', venueOverride: null, reason: '恢復共用地點', revision: overridden.revision, requestId: randomUUID() };
  await req('/api/events/' + second.id, 'PATCH', settings, 403, staff);
  await req('/api/events/' + second.id, 'PATCH', settings);
  overridden = await req('/api/admin/events/' + second.id);
  assert.equal(overridden.venue, '再改總館');
  await req('/api/events/' + second.id, 'PATCH', { ...settings, venueOverride: '', revision: overridden.revision, requestId: randomUUID() });
  assert.equal((await req('/api/events/' + second.id)).venue, '');
  // Archive is competition-wide and cannot be bypassed via stage or staff endpoints.
  c = await catalog(id);
  const archive = {name:c.name,prefix:c.prefix,venue:c.venue,revision:c.revision,requestId:randomUUID(),archived:true};
  await req('/api/competitions/' + id,'PATCH',archive,401,'');
  await req('/api/competitions/' + id,'PATCH',archive,403,staff);
  await req('/api/competitions/' + id,'PATCH',archive);
  await req('/api/competitions/' + id,'PATCH',archive); // idempotent
  for (const auth of ['',staff]) {
    assert.ok(!(await req('/api/competitions','GET',undefined,200,auth)).competitions.some((x:any)=>x.id===id));
    assert.ok(!(await req('/api/events','GET',undefined,200,auth)).events.some((x:any)=>[first.id,second.id].includes(x.id)));
    for (const stageId of [first.id,second.id]) await req('/api/events/'+stageId,'GET',undefined,404,auth);
  }
  await req('/api/admin/events/'+second.id,'GET',undefined,404,staff);
  await req('/api/events/'+second.id,'PATCH',{action:'penalty',participantId:'t1',amount:1,reason:'test archive',revision:1,requestId:randomUUID()},404,staff);
  const collection = await fetch(origin+'/api/club/'+second.id,{headers:{Authorization:'Bearer '+ 'a'.repeat(64)}});
  assert.equal(collection.status,404);
  assert.equal((await req('/api/events/'+second.id)).competition.archived,true);
  assert.equal((await req('/api/admin/events/'+second.id)).competition.archived,true);
  c = await catalog(id);
  await req('/api/competitions/'+id,'PATCH',{...archive,archived:false,revision:c.revision,requestId:randomUUID()});
  assert.equal((await req('/api/events/'+second.id,'GET',undefined,200,'')).competition.archived,false);
  const sourceForCopy = await req('/api/admin/events/'+second.id);
  const copyBody = {name:'完整副本',revision:sourceForCopy.revision};
  await req('/api/admin/events/'+second.id+'/duplicate','POST',copyBody,401,'');
  await req('/api/admin/events/'+second.id+'/duplicate','POST',copyBody,403,staff);
  await req('/api/admin/events/'+second.id+'/duplicate','POST',{...copyBody,revision:999999},409);
  const copied = await req('/api/admin/events/'+second.id+'/duplicate','POST',copyBody,201);
  const copyEvent = await req('/api/admin/events/'+copied.id);
  assert.equal(copyEvent.parentEventId,id);
  assert.equal(copyEvent.stageName,'完整副本');
  assert.deepEqual(copyEvent.assignments,sourceForCopy.assignments);
  assert.deepEqual(copyEvent.results,sourceForCopy.results);
  assert.equal((await req('/api/admin/events/'+second.id)).revision,sourceForCopy.revision);
  await removeStage(copied.id);
  await removeStage(first.id);
  assert.equal((await catalog(id)).stages.length, 1);
  await req('/api/events/' + second.id);
  await removeStage(second.id);
  c = await catalog(id); assert.deepEqual(c.stages, []); assert.equal(c.venue, '再改總館');
  const third = await req(`/api/competitions/${id}/stages`, 'POST', { stage, revision: c.revision }, 201);
  await req('/api/admin/competitions', 'DELETE', { competitions: [{ id, revision: c.revision, confirmName: c.name, stages: [] }] }, 409);
  await removeStage(third.id);
  c = await catalog(id);
  await req('/api/admin/competitions', 'DELETE', { competitions: [{ id, revision: c.revision, confirmName: c.name, stages: [] }] });
  assert.equal(await catalog(id), undefined);

  // Legacy root deletion must preserve its child even before metadata extraction.
  await removeStage(legacy.event.id);
  const kept = await req('/api/admin/events/' + sibling.event.id);
  assert.equal(kept.competition.name, legacy.event.name);
  assert.deepEqual(kept.results, sibling.event.results);
  assert.deepEqual(kept.club.tokens, sibling.event.club.tokens);
  assert.deepEqual(kept.assignments, sibling.event.assignments);
  await removeStage(sibling.event.id);
  assert.deepEqual((await catalog(legacy.event.id)).stages, []);
  // Shared edits migrate the other legacy root without changing scoring data.
  c = await catalog(legacyEdit.event.id);
  await req('/api/competitions/' + c.id, 'PATCH', { ...shared, name: '已分離賽事', revision: c.revision, requestId: randomUUID() });
  const migrated = await req('/api/admin/events/' + legacyEdit.event.id);
  assert.equal(migrated.revision, legacyEdit.event.revision + 1);
  assert.deepEqual(migrated.results, legacyEdit.event.results);
  assert.deepEqual(migrated.projection, JSON.parse(JSON.stringify(legacyEdit.projection)));
  assert.equal(migrated.name, legacyEdit.event.name);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.ok(saved.some((d: { competition?: { id: string } }) => d.competition?.id === legacy.event.id));
  assert.equal((await fetch(origin + '/?competition=' + legacy.event.id)).status, 200);
  console.log('Empty competition production-build smoke passed: permissions, CAS/idempotency, empty lifecycle, venues, dates, first/last deletion, legacy migration and preservation of scores/links.');
} finally {
  child.kill();
  await new Promise<void>(resolve => child.exitCode !== null ? resolve() : child.once('exit', () => resolve()));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('valet-empty-competition-'));
  await rm(directory, { recursive: true, force: true });
}
}
main().catch(error => { console.error(error); process.exitCode = 1; });
