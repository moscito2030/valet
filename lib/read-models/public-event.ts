import { boardsStillInPlay } from '../board-in-play';
import { knockoutExemptAssignments } from '../knockout-status';
import type { BridgeEvent, Projection } from '../model';
import { presentBoards } from '../public-event';
import { normalizeResults } from '../result-status';
import { allRoundsComplete, enteredBoardCounts, roundProgress } from '../round-progress';
import { project } from '../scoring';
export function audienceScoring(event: BridgeEvent, projection?: Projection) {
  const { club } = event;
  const finalized = new Set(club?.finalized ?? []);
  const exempt = knockoutExemptAssignments(event);
  const published = new Set(club?.publishedAssignments ?? []);
  const visible = club?.enabled
    ? new Set(event.assignments.filter((a) => finalized.has(a.round) || published.has(a.id) || exempt.has(a.id)).map((a) => a.id))
    : null;
  const waiting = boardsStillInPlay(event);
  // Hands already follow `published`. Scores, pair IMPs and standings must too:
  // finishing every table, or settling the round, does not publish a board the director left hidden.
  const publishedBoards = new Set(
    event.boards.filter((b) => b.published === true).map((b) => b.number),
  );
  const results = Object.fromEntries(
    Object.entries(normalizeResults(event.results)).filter(
      ([, r]) =>
        publishedBoards.has(r.board) &&
        !waiting.has(r.board) &&
        (!visible || visible.has(r.assignmentId)),
    ),
  );
  const allResultsVisible = Object.keys(results).length === Object.keys(event.results).length;
  const publicScoring = { ...event, results };
  if (!allResultsVisible && event.provisionalVp) {
    const active = new Set((projection ?? project(event)).matches.filter(match => match.provisional).map(match => match.id));
    publicScoring.provisionalVp = Object.fromEntries(Object.entries(event.provisionalVp).map(([id, item]) =>
      [id, active.has(id) ? item : { vp: null }]));
  }
  return publicScoring;
}

export function audienceEvent(event: BridgeEvent, projection?: Projection, publicProjection?: Projection,
  publicScoring = audienceScoring(event, projection)) {
  const { club } = event;
  const data = {
    clubEnabled: !!club?.enabled,
    id: event.id,
    name: event.name,
    kind: event.kind,
    rankingMode: event.rankingMode,
    teamMethod: event.teamMethod,
    teamFormat: event.teamFormat,
    bam: event.bam,
    gameMode: event.gameMode,
    date: event.date,
    endDate: event.endDate,
    venue: event.venue,
    venueOverride: event.venueOverride,
    rounds: event.rounds,
    boardsPerRound: event.boardsPerRound,
    maxBoardNumber: event.maxBoardNumber,
    awardPlaces: event.awardPlaces,
    awardPlacesNS: event.awardPlacesNS,
    awardPlacesEW: event.awardPlacesEW,
    audienceRefreshSeconds: event.audienceRefreshSeconds,
    danmakuDefaultEnabled: event.danmakuDefaultEnabled,
    showScoreCandles: event.showScoreCandles,
    awardDescription: event.awardDescription,
    winAward: event.winAward,
    movementDescription: event.movementDescription,
    movementImported: event.movementImported,
    teamMovement: event.teamMovement,
    byeVp: event.byeVp,
    // Publish schedules, never the director's potentially unpublished scoring snapshot.
    swiss: event.swiss
      ? {
          mode: event.swiss.mode,
          publications: event.swiss.publications.map((p) => ({
            round: p.round,
            sourceRound: p.sourceRound,
            sourceRevision: p.sourceRevision,
            at: p.at,
            pairs: p.pairs,
            bye: p.bye,
            basis: [],
            byeBasis: [],
            scores: [],
          })),
        }
      : undefined,
    knockout: event.knockout
      ? {
          nodes: event.knockout.nodes,
          adjustments: event.knockout.adjustments,
          extraLegs: event.knockout.extraLegs,
          withdrawn: event.knockout.withdrawn,
          published: event.knockout.published,
          decisions: Object.fromEntries(
            Object.entries(event.knockout.decisions).map(([id, d]) => [
              id,
              { winner: d.winner, loser: d.loser, reason: d.reason, method: d.method },
            ]),
          ),
        }
      : undefined,
    currentRound: event.currentRound,
    roundPhase: event.roundPhase,
    roundTimes: event.roundTimes,
    status: event.status === 'live' && allRoundsComplete(event) ? 'review' as const : event.status,
    pairMethod: event.pairMethod,
    neuberg: event.neuberg,
    adjustedSession: event.adjustedSession,
    trim: event.trim,
    penalties: event.penalties,
    demo: event.demo,
    participants: event.participants.map((p) => ({
      id: p.id,
      name: p.name,
      players: p.players,
      captain: p.captain,
      group: p.group,
    })),
    assignments: event.assignments.map((a) => ({
      id: a.id,
      round: a.round,
      table: a.table,
      room: a.room,
      ns: a.ns,
      ew: a.ew,
      boards: a.boards,
      matchId: a.matchId,
      playerNames: a.playerNames,
    })),
    parentEventId: event.parentEventId,
    stageName: event.stageName,
    hasStages: event.hasStages,
    competition: event.competition,
    revision: event.revision,
    updatedAt: event.updatedAt,
    results: normalizeResults(event.results),
  };
  const { results } = publicScoring;
  const safe = { ...data, results };
  const boards = presentBoards(event);
  return {
    ...safe,
    boards,
    // Receipt counts use every stored result and do not include contracts.
    // Scores stay out of `results` until the director publishes the board and it is no longer in play.
    enteredBoards: enteredBoardCounts(event),
    // Same stored results, summed the way standings count 完成. Only the numbers
    // are public; the projection below still scores the filtered results.
    receivedByParticipant: receivedByParticipant(projection ?? project(event)),
    collectionProgress: roundProgress(event),
    projection: publicProjection ?? (Object.keys(results).length === Object.keys(event.results).length && projection && !event.knockout ? projection : project(publicScoring)),
  };
}

function receivedByParticipant(projection: Projection) {
  const counts: Record<string, number> = {};
  for (const row of projection.standings) if (row.played) counts[row.id] = row.played;
  return counts;
}
