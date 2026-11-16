import test from 'node:test';
import assert from 'node:assert/strict';
import { neighboringBoard } from '../lib/board-navigation';
import { directionalDatum } from '../lib/datum';
import { createEvent } from '../lib/domain/event-factory';
import { roundedDatum } from '../lib/scoring';
import type { Result } from '../lib/model';

test('matchpoint events do not keep an IMP trim, and Butler datum uses one rounding rule', () => {
  const event = createEvent({
    name: '預設 MP',
    kind: 'pairs',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-16',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
    trim: 'one',
  });
  assert.equal(event.pairMethod, 'mp');
  assert.equal(event.trim, 'none');
  const butler = createEvent({
    name: 'Butler',
    kind: 'pairs',
    pairMethod: 'butler',
    trim: 'one',
    names: ['A', 'B', 'C', 'D'],
    date: '2026-11-16',
    venue: '',
    rounds: 1,
    boardsPerRound: 1,
  });
  assert.equal(butler.trim, 'one');
  assert.equal(roundedDatum(15), 20);
  const result = (nsScore: number): Result => ({
    assignmentId: 'a',
    board: 1,
    level: 1,
    strain: 'NT',
    doubled: 1,
    declarer: 'N',
    tricks: 7,
    lead: '',
    nsScore,
    updatedAt: '',
  });
  assert.equal(directionalDatum([result(15), result(25), result(5)]).ns.datum, roundedDatum(15));
});

test('board navigation follows the sorted board numbers', () => {
  const numbers = [2, 4, 9];
  assert.equal(neighboringBoard(numbers, 2, -1), undefined);
  assert.equal(neighboringBoard(numbers, 2, 1), 4);
  assert.equal(neighboringBoard(numbers, 4, 1), 9);
  assert.equal(neighboringBoard(numbers, 9, 1), undefined);
  assert.equal(neighboringBoard(numbers, 3, 1), undefined);
});
