import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableScoreReview } from '../components/table-score-review';
import { createEvent } from '../lib/events';
import { project } from '../lib/scoring';

test('table review includes missing and cancelled boards, lead, HCP and both awarded scores without other tables', () => {
  const event = createEvent({name:'Review',kind:'pairs',names:['A','B','C','D'],rounds:1,boardsPerRound:3,date:'2026-10-19',venue:''});
  const a=event.assignments[0];
  const r={assignmentId:a.id,board:a.boards[0],level:1,strain:'H' as const,declarer:'N' as const,doubled:1 as const,tricks:7,lead:'SA',hcp:{N:12},nsScore:80,updatedAt:'2026-10-19'};
  event.results[`${a.id}:${a.boards[0]}`]={...r,split:{ns:{...r,nsScore:110},ew:{...r,nsScore:-50}}};
  event.results[`${a.id}:${a.boards[1]}`]={...r,board:a.boards[1],status:'cancelled'};
  const other=event.assignments[1];
  event.results[`${other.id}:${other.boards[0]}`]={...r,assignmentId:other.id,nsScore:9999};
  const before=JSON.stringify(event);
  const html=renderToStaticMarkup(createElement(TableScoreReview,{event:{...event,projection:project(event)},assignment:a}));
  for(const value of ['第 1 副','第 2 副','第 3 副','待收分','取消','SA','N 12','NS +110','EW +50','不平衡合約']) assert.ok(html.includes(value),value);
  assert.ok(!html.includes('9999'));
  assert.equal(JSON.stringify(event),before);
});
