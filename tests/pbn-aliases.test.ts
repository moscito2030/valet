import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent } from '../lib/domain/event-factory';
import { exportPbn, parsePbn } from '../lib/imports';
import { makeBoard } from '../lib/domain/board-factory';
import { mutationSchema, seats, type Board } from '../lib/model';
import { createNeonRepository } from '../lib/storage/neon';
import { createTestDb } from './helpers/sql';

function sorted(deal: Board['deal']) {
  return Object.fromEntries(seats.map((seat) => [seat, [...deal[seat]].sort()]));
}

test('PBN vulnerability import accepts the standard names and aliases, and export writes only None, NS, EW, or All', () => {
  const board = makeBoard(1);
  const source = exportPbn({ boards: [board] });
  assert.match(source, /\[Vulnerable "None"\]/);
  const cases: [string, Board['vulnerability']][] = [
    ['None', 'None'],
    ['none', 'None'],
    ['NONE', 'None'],
    ['Love', 'None'],
    [' love ', 'None'],
    ['-', 'None'],
    ['NS', 'NS'],
    ['ns', 'NS'],
    ['EW', 'EW'],
    ['ew', 'EW'],
    ['All', 'All'],
    ['ALL', 'All'],
    ['Both', 'All'],
    ['both', 'All'],
  ];
  for (const [raw, expected] of cases) {
    const parsed = parsePbn(source.replace('[Vulnerable "None"]', `[Vulnerable "${raw}"]`));
    assert.equal(parsed[0].vulnerability, expected, raw);
    const exported = exportPbn({ boards: parsed });
    assert.match(exported, new RegExp(`\\[Vulnerable "${expected}"\\]`));
    assert.doesNotMatch(exported, /\[Vulnerable "(?:Love|Both|-|love|both)"\]/);
  }
  assert.throws(() => parsePbn(source.replace('[Vulnerable "None"]', '[Vulnerable "Yes"]')));
});

test('PBN import accepts vulnerability aliases, keeps the first duplicate, and warns on nonstandard dealer', () => {
  const board = makeBoard(2);
  const pbn = exportPbn({ boards: [board] }).replace('[Vulnerable "NS"]', '[Vulnerable "N-S"]').replace('[Dealer "E"]', '[Dealer "East"]');
  const warnings: string[] = [];
  const parsed = parsePbn(pbn + '\n' + pbn, warnings);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].vulnerability, 'NS');
  assert.equal(parsed[0].dealer, 'E');
  assert.deepEqual(sorted(parsed[0].deal), sorted(board.deal));
  assert.ok(warnings.some((warning) => warning.includes('重複')));
  const odd = parsePbn(exportPbn({ boards: [makeBoard(1)] }).replace('[Vulnerable "None"]', '[Vulnerable "Both"]'), warnings);
  assert.equal(odd[0].vulnerability, 'All');
  assert.ok(warnings.some((warning) => warning.includes('慣例')));
});

test('imported vulnerability aliases are stored as None, NS, EW, or All in normalized board rows', async () => {
  const canonical = ['None', 'NS', 'EW', 'All'] as const;
  const aliases = ['Love', 'N-S', 'E/W', 'Both'];
  const db = await createTestDb();
  try {
    const repo = createNeonRepository(db.sql);
    const event = createEvent({
      name: '身價匯入',
      kind: 'pairs',
      date: '2026-11-20',
      venue: '測試',
      names: ['甲', '乙', '丙', '丁'],
      rounds: 1,
      boardsPerRound: 4,
    });
    await repo.insertEvent(event);
    const generated = event.boards.map((board) => makeBoard(board.number));
    let pbn = exportPbn({ boards: generated });
    for (let index = 0; index < aliases.length; index++) {
      pbn = pbn.replace(`[Vulnerable "${canonical[index]}"]`, `[Vulnerable "${aliases[index]}"]`);
    }
    const saved = await repo.mutateEvent(
      event.id,
      mutationSchema.parse({
        action: 'pbn',
        pbn,
        revision: event.revision,
        requestId: randomUUID(),
        reason: '匯入身價別名',
      }),
    );
    assert.deepEqual(
      saved.event.boards.map((board) => board.vulnerability),
      [...canonical],
    );
    for (let index = 0; index < generated.length; index++) {
      assert.deepEqual(sorted(saved.event.boards[index].deal), sorted(generated[index].deal));
    }
    const exported = exportPbn({ boards: saved.event.boards });
    for (const name of canonical) assert.match(exported, new RegExp(`\\[Vulnerable "${name}"\\]`));
    assert.doesNotMatch(exported, /\[Vulnerable "(?:Love|Both|N-S|E\/W)"\]/);
    const reread = await repo.getEvent(event.id);
    assert.deepEqual(
      reread.event.boards.map((board) => board.vulnerability),
      [...canonical],
    );
    const rows = await db.sql`SELECT document_json FROM bridge_boards WHERE event_id = ${event.id} ORDER BY board_number`;
    const boards = rows.map((row) => JSON.parse(String(row.document_json)) as Board);
    assert.deepEqual(
      boards.map((board) => board.vulnerability),
      [...canonical],
    );
    for (let index = 0; index < generated.length; index++) {
      assert.deepEqual(sorted(boards[index].deal), sorted(generated[index].deal));
    }
    const legacyRows = await db.sql`SELECT count(*)::int AS n FROM bridge_events WHERE document->'event'->>'id' = ${event.id}`;
    assert.equal(Number(legacyRows[0].n), 0);
  } finally {
    await db.close();
  }
});
