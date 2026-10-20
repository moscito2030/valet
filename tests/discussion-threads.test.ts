import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionThreads } from '../lib/discussion-threads';
test('replies follow their parent with stable sibling order and nested depth', () => {
  const comments = [{id:'a'}, {id:'b'}, {id:'c',replyTo:'a'}, {id:'d',replyTo:'c'}, {id:'e',replyTo:'a'}];
  assert.deepEqual(discussionThreads(comments).map(({comment,depth}) => [comment.id,depth]), [['a',0],['c',1],['d',2],['e',1],['b',0]]);
});
test('missing parents and cycles retain each comment once', () => {
  const comments = [{id:'a',replyTo:'gone'}, {id:'b',replyTo:'c'}, {id:'c',replyTo:'b'}, {id:'d',replyTo:'d'}];
  const result = discussionThreads(comments);
  assert.equal(result.length,4);
  assert.equal(new Set(result.map(x=>x.comment.id)).size,4);
  assert.equal(result.find(x=>x.comment.id==='a')?.depth,0);
});
