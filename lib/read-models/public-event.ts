import type { BridgeEvent, Projection } from '../model';
import { publicBoards } from '../public-event';
import { normalizeResults } from '../result-status';
import { allRoundsComplete, roundProgress } from '../round-progress';
import { project } from '../scoring';
export function audienceEvent(event: BridgeEvent, projection?: Projection) {
  const { club } = event;
  const data = {
    clubEnabled: !!club?.enabled,
    id: event.id,
    name: event.name,
    prefix: event.prefix,
    kind: event.kind,
    rankingMode: event.rankingMode,
    teamMethod: event.teamMethod,
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
          published: event.knockout.published,
          decisions: Object.fromEntries(
            Object.entries(event.knockout.decisions).map(([id, d]) => [
              id,
              { winner: d.winner, loser: d.loser, reason: d.reason },
            ]),
          ),
        }
      : undefined,
    currentRound: event.currentRound,
    roundPhase: event.roundPhase,
    roundTimes: event.roundTimes,
    status: event.status === 'live' && allRoundsComplete(event) ? 'review' as const : event.status,
    publishBoards: event.publishBoards,
    pairMethod: event.pairMethod,
    neuberg: event.neuberg,
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
  const finalized = new Set(club?.finalized ?? []);
  const visible = club?.enabled
    ? new Set(event.assignments.filter((a) => finalized.has(a.round)).map((a) => a.id))
    : null;
  const results = visible
    ? Object.fromEntries(
        Object.entries(data.results).filter(([, r]) => visible.has(r.assignmentId)),
      )
    : data.results;
  const safe = { ...data, results };
  // A board can recur in later rounds: keep its deal private until every scheduled use is settled.
  const unsettledBoards = new Set(
    club?.enabled
      ? event.assignments.filter((a) => !finalized.has(a.round)).flatMap((a) => a.boards)
      : [],
  );
  const boards = publicBoards(event).map((b) => {
    if (unsettledBoards.has(b.number)) {
      const { deal, ...rest } = { ...b, deal: undefined };
      return { ...rest, published: false };
    }
    return b;
  });
  // Reuse only when the stored projection sees exactly the same results as the audience.
  // Any hidden result forces a fresh public projection; no cross-request/private cache is used.
  const allResultsVisible =
    !visible || Object.keys(results).length === Object.keys(data.results).length;
  return {
    ...safe,
    boards,
    collectionProgress: roundProgress(event),
    projection: allResultsVisible && projection ? projection : project({ ...event, results }),
  };
}
