import test from 'node:test';
import assert from 'node:assert/strict';
import { DeclarerWarning } from '../components/hcp-fields';
import { resultSchema } from '../lib/model';
const value = resultSchema.parse({assignmentId:'a1',board:1,level:1,strain:'NT',doubled:1,declarer:'N',tricks:7});
const actualHcp={N:12,E:8,S:13,W:7};
test('declarer warning uses actual HCP even with blank, contradictory or invalid recorded HCP',()=>{
 for(const hcp of [undefined,{N:15,E:8,S:10,W:7},{N:99}]) {
  const warning=DeclarerWarning({value:{...value,hcp},dealer:'N',actualHcp});
  assert.ok(warning);
  assert.match(String(warning.props.children),/依實際牌型大牌點應為南家/);
 }
 assert.equal(DeclarerWarning({value:{...value,declarer:'S',hcp:{N:15,E:8,S:10,W:7}},dealer:'N',actualHcp}),null);
});
test('missing deal does not fall back to recorded HCP; actual tie prompts redeal',()=>{
 assert.equal(DeclarerWarning({value:{...value,hcp:actualHcp},dealer:'N'}),null);
 assert.ok(DeclarerWarning({value,dealer:'N',actualHcp:{N:10,E:10,S:10,W:10}}));
 assert.equal(DeclarerWarning({value,dealer:'N',actualHcp:{N:12}}),null);
});
