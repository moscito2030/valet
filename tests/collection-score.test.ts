import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionScoreSide, collectionScoreLabel } from '../lib/collection-score';
import type { ClubView } from '../lib/club-view';
import type { Result } from '../lib/model';
test('collection follows pair seats and shared-device handoff, including accepted results', () => {
  const data = {role:'input',pair:'p2',roles:{inputPair:'p2',confirmPair:'p1'},assignment:{ns:'p1',ew:'p2'},accepted:false} as ClubView;
  assert.equal(collectionScoreSide(data,false),'EW');
  assert.equal(collectionScoreSide({...data,role:'confirm',pair:'p1'},false),'NS');
  assert.equal(collectionScoreSide({...data,role:'shared',pair:'device'},false),'EW');
  assert.equal(collectionScoreSide({...data,role:'shared',pair:'device'},true),'NS');
  assert.equal(collectionScoreSide({...data,role:'shared',accepted:true},false),'NS');
});
test('collection score uses correct split award rather than negating the other side award', () => {
  assert.equal(collectionScoreLabel({nsScore:70},'EW'),'EW -70');
  assert.equal(collectionScoreLabel({nsScore:-50},'EW'),'EW +50');
  assert.equal(collectionScoreLabel({nsScore:0},'EW'),'EW 0');
  const split={ns:{nsScore:110},ew:{nsScore:-50}} as Result['split'];
  assert.equal(collectionScoreLabel({nsScore:110,split},'NS'),'NS +110');
  assert.equal(collectionScoreLabel({nsScore:110,split},'EW'),'EW +50');
});
