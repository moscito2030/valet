import test from 'node:test';
import assert from 'node:assert/strict';
import {nextBullets,type BulletComment} from '../lib/discussion-bullets';
const comments=Array.from({length:40},(_,i):BulletComment=>({id:String(i),nickname:'Player',text:`4!s ${i}`}));
test('danmaku starts with bounded recent history and does not repeat on refresh',()=>{
 const first=nextBullets(comments,new Set(),true);
 assert.deepEqual(first.fresh.map(c=>c.id),comments.slice(-8).map(c=>c.id));
 const refresh=nextBullets(comments,first.seen,false);assert.equal(refresh.fresh.length,0);
 const added={id:'new',nickname:'N',text:'!hA'};
 assert.deepEqual(nextBullets([...comments,added],refresh.seen,false).fresh,[added]);
});
test('danmaku excludes hidden/deleted content even from director responses and caps bursts',()=>{
 const hidden=comments.map(c=>({...c,hidden:true}));assert.equal(nextBullets(hidden,new Set(),true).fresh.length,0);
 assert.equal(nextBullets([{...comments[0],deleted:true}],new Set(),true).fresh.length,0);
 assert.equal(nextBullets(comments,new Set(),false).fresh.length,30);
 const first=nextBullets(hidden,new Set(),true);assert.equal(nextBullets(comments,first.seen,false).fresh.length,0);
});
