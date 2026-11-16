import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPbn, parsePbn } from '../lib/imports';
import { makeBoard } from '../lib/domain/board-factory';
import { seats, type Board } from '../lib/model';

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
