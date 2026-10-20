import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shuffledBullets,
  takeAvailableBullet,
  freeBulletLane,
  bulletDuration,
  bulletFonts,
  randomBulletFont,
  type BulletComment,
} from '../lib/discussion-bullets';
const comments = Array.from({ length: 40 }, (_, i): BulletComment => ({
  id: String(i),
  nickname: 'Player',
  text: `4!s ${i}`,
}));
test('every visible comment appears once per cycle, including subsequent cycles', () => {
  const first = shuffledBullets(comments, undefined, () => 0);
  const second = shuffledBullets(comments, first.at(-1)?.id, () => 0.5);
  for (const cycle of [first, second]) {
    assert.equal(cycle.length, 40);
    assert.equal(new Set(cycle.map((c) => c.id)).size, 40);
  }
  assert.notDeepEqual(first, second);
  assert.notEqual(first.at(-1)?.id, second[0].id);
  assert.equal(comments[0].id, '0');
});
test('cycles exclude hidden/deleted comments and include new arrivals', () => {
  const current = [
    { ...comments[0], hidden: true },
    { ...comments[1], deleted: true },
    comments[2],
  ];
  assert.deepEqual(shuffledBullets(current), [comments[2]]);
  assert.deepEqual(shuffledBullets([]), []);
  assert.equal(shuffledBullets([comments[0]], '0').length, 1);
  assert.equal(shuffledBullets([...current, comments[3]]).length, 2);
});
test('random lane selection never reuses an occupied lane', () => {
  assert.equal(
    freeBulletLane([0, 1, 2], () => 0),
    3,
  );
  assert.equal(freeBulletLane([0, 1, 2, 3, 4, 5]), undefined);
  assert.equal(
    freeBulletLane([], () => 0),
    0,
  );
  assert.equal(
    freeBulletLane([], () => 0.99),
    5,
  );
});

test('mobile duration stays unchanged while wide boards get more travel time', () => {
  assert.equal(bulletDuration(390), 7500);
  assert.equal(bulletDuration(600), 7500);
  assert.equal(bulletDuration(960), 12000);
  assert.equal(bulletDuration(1200), 15000);
});

test('all five distinct font stacks are selectable', () => {
  assert.equal(new Set(bulletFonts).size, 5);
  bulletFonts.forEach((font, i) =>
    assert.equal(
      randomBulletFont(() => (i + 0.5) / 5),
      font,
    ),
  );
});

test('Latin faces match five styles and every Chinese stack has a Traditional fallback', () => {
  const latin = bulletFonts.map((font) => font.split(',')[0]);
  assert.equal(new Set(latin).size, 5);
  for (const font of bulletFonts) assert.match(font, /Noto (Sans|Serif) TC/);
  assert.match(bulletFonts[3], /Iansui/);
  assert.match(bulletFonts[4], /Huninn/);
});

test('on-screen comments wait in the queue while other comments can launch', () => {
  const queue = [comments[0], comments[1]];
  assert.equal(takeAvailableBullet(queue, ['0'])?.id, '1');
  assert.equal(takeAvailableBullet(queue, ['0', '1']), undefined);
  assert.deepEqual(queue, [comments[0]]);
  assert.equal(takeAvailableBullet(queue, [])?.id, '0');
  assert.equal(queue.length, 0);
});
test('a single comment cannot repeat until its previous instance exits', () => {
  const queue = [comments[0]];
  assert.equal(takeAvailableBullet(queue, ['0']), undefined);
  assert.equal(takeAvailableBullet(queue, [])?.id, '0');
});
