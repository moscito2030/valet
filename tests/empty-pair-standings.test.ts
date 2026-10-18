import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from '../lib/events';
import { project } from '../lib/scoring';
for (const pairMethod of ['mp','butler','crossimp'] as const) {
  test(`empty ${pairMethod} standings use neutral scores, rank ties and retain penalties`, () => {
    const event = createEvent({name:'Empty standings',kind:'pairs',pairMethod,names:['A','B','C','D'],date:'2026-10-18',venue:'',rounds:1,boardsPerRound:2});
    const neutral=pairMethod === 'mp' ? 50 : 0;
    const rows=project(event).standings;
    assert.ok(rows.every(r => r.score === neutral && r.rank === 1 && r.played === 0 && r.secondary === 0));
    event.penalties={[event.participants[0].id]:2};
    const penalized=project(event).standings;
    assert.equal(penalized.find(r => r.id === event.participants[0].id)?.score, neutral-2);
    assert.equal(penalized.at(-1)?.id, event.participants[0].id);
  });
}
