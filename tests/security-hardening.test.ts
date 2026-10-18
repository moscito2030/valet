import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, verifySession } from '../lib/session-token';
import { csvCell } from '../lib/csv-cell';
import { parseCsv } from '../lib/imports';
import { exportLineups, parseLineups } from '../lib/lineup-import';
import { createEvent } from '../lib/events';
import { project } from '../lib/scoring';
import { audienceEvent } from '../lib/club-view';
import { eventIndex } from '../lib/event-index';
import { canMutate } from '../lib/mutation-permissions';
import type { Mutation, Result } from '../lib/model';

const config = {
  secret: 's'.repeat(32),
  adminPassword: 'a'.repeat(16),
  directorPassword: 'd'.repeat(16),
};
test('sessions reject tampering, expiration, extra segments and revoked credentials', () => {
  const now = 1000000,
    token = createSession('admin', config, now);
  assert.equal(verifySession(token, config, now + 1), 'admin');
  assert.equal(verifySession(token, config, now + 28800000), null);
  assert.equal(verifySession(token + 'extra', config, now), null);
  assert.equal(verifySession(token + ':extra', config, now), null);
  assert.equal(verifySession(token.replace('admin', 'director'), config, now), null);
  assert.equal(verifySession(token, { ...config, adminPassword: 'b'.repeat(16) }, now), null);
  assert.equal(verifySession(token, { ...config, secret: 't'.repeat(32) }, now), null);
  const director = createSession('director', config, now);
  assert.equal(verifySession(director, config, now), 'director');
  assert.equal(verifySession(director, { ...config, directorPassword: undefined }, now), null);
  assert.equal(verifySession(director, { ...config, directorPassword: 'e'.repeat(16) }, now), null);
});
function event(kind: 'pairs' | 'teams' = 'pairs') {
  return createEvent({
    name: '安全測試',
    kind,
    date: '2026-10-17',
    venue: '',
    names: ['A', 'B', 'C', 'D'],
    rounds: 1,
    boardsPerRound: 1,
  });
}
test('legacy average and cancelled produce identical team and pair scores without mutating input', () => {
  for (const kind of ['teams', 'pairs'] as const) {
    const e = event(kind);
    for (const a of e.assignments)
      e.results[a.id + ':1'] = {
        assignmentId: a.id,
        board: 1,
        level: 0,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 0,
        lead: '',
        nsScore: 0,
        updatedAt: '',
        status: 'average',
      };
    const legacy = project(e);
    assert.ok(Object.values(e.results).every((r) => r.status === 'average'));
    for (const r of Object.values(e.results)) r.status = 'cancelled';
    assert.deepEqual(project(e), legacy);
    if (kind === 'pairs') assert.ok(legacy.standings.every((s) => s.score === (e.pairMethod && e.pairMethod !== 'mp' ? 0 : 50)));
    else assert.ok(legacy.matches.every((m) => m.vpA === null));
  }
});
test('CSV formulas and apostrophe-prefixed names round trip and lineups use the same protection', () => {
  for (const text of [
    '=1+1',
    '+1',
    '-1',
    '@SUM(1)',
    "'姓名",
    "'=1+1",
    '普通姓名',
    '姓,名',
    '姓"名',
  ]) {
    const encoded = csvCell(text);
    assert.equal(parseCsv('name\n' + encoded)[0].name, text);
    if (/^[=+@\-']/.test(text)) assert.ok(encoded.startsWith('"\''));
  }
  const e = event('teams'),
    a = e.assignments[0];
  a.playerNames = { N: '=1+1' };
  const csv = exportLineups(e);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.equal(parseLineups(csv, e)[0].playerNames.N, '=1+1');
});
test('public responses and index omit private and newly introduced fields', () => {
  const e = event();
  Object.assign(e, { privateFutureField: 'secret' });
  const view = audienceEvent(e);
  assert.ok(!('privateFutureField' in view));
  assert.ok(!('audit' in view));
  assert.ok(!('club' in view));
  assert.ok(view.boards.every((b) => !('deal' in b)));
  const index = eventIndex({ event: e, projection: project(e), requests: [] });
  assert.ok(!('results' in index.event));
  assert.ok(!('audit' in index.event));
  assert.ok(index.event.boards.every((b) => !('deal' in b)));
});
test('mutation policy denies anonymous, club bypass and staff imports while preserving collection permissions', () => {
  const command = (action: string, fields = {}) => ({ action, ...fields }) as Mutation;
  assert.equal(canMutate(null, command('results')), false);
  for (const action of [
    'rosters-import',
    'pbn',
    'split-contract',
    'clear-results',
    'movement',
    'board-publication',
  ]) {
    assert.equal(canMutate('admin', command(action)), false);
    assert.equal(canMutate('director', command(action)), true);
  }
  for (const action of ['results', 'ruling', 'penalty', 'table-lineup'])
    assert.equal(canMutate('admin', command(action)), true);
  for (const role of ['admin', 'director'] as const)
    assert.equal(canMutate(role, command('club-play')), false);
  assert.equal(canMutate('admin', command('settings', { stageName: '變更' })), false);
});
