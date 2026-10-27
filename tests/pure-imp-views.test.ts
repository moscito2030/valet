import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { randomUUID } from 'node:crypto';
import { createEvent, applyMutation } from '../lib/events';
import { mutationSchema } from '../lib/model';
import { project } from '../lib/scoring';
import { audienceEvent } from '../lib/read-models/public-event';
import { RoundsView } from '../components/scoreboard/RoundsView';
import { PlayersView } from '../components/scoreboard/PlayersView';
import { KnockoutView } from '../components/knockout-view';
import { TeamScoringFields } from '../components/team-scoring-settings';

test('creation exposes pure IMP and KO round, player and bracket output never display VP', () => {
  const raw = createEvent({
    name: '介面檢查',
    kind: 'teams',
    teamFormat: 'knockout',
    names: ['Alpha', 'Beta'],
    date: '2026-10-28',
    venue: '',
    rounds: 1,
    boardsPerRound: 2,
  });
  const event = applyMutation(
    { event: raw, projection: project(raw), requests: [] },
    mutationSchema.parse({
      action: 'knockout-publish',
      revision: 1,
      requestId: randomUUID(),
      reason: '公布對戰',
    }),
  ).event;
  const publicEvent = audienceEvent(event),
    noop = () => {};
  assert.match(
    renderToStaticMarkup(createElement(TeamScoringFields, { allowKnockout: true })),
    /純 IMP 淘汰賽/,
  );
  const common = {
    event: publicEvent,
    setBoard: noop,
    setPerson: noop,
    setPlayerRound: noop,
    setRound: noop,
    setSelectedResult: noop,
    setTab: noop,
  };
  for (const element of [
    createElement(KnockoutView, { event: publicEvent }),
    createElement(RoundsView, { ...common, round: 1 }),
    createElement(PlayersView, {
      ...common,
      person: 't1',
      playerRound: 1,
      playerSort: 'round',
      setPlayerSort: noop,
      setTravellerSide: noop,
    }),
  ]) {
    const html = renderToStaticMarkup(element);
    assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /\bVP\b/);
    assert.match(html, /IMP/);
  }
});
