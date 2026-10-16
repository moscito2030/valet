import type { BridgeEvent } from './model';
import { normalizeResults } from './result-status';
import type { Projection } from './model';
import { resultKey } from './model';
import { project } from './scoring';
import { publicBoards } from './public-event';
import { roundProgress } from './round-progress';
import { clubAccepted, clubReviewVersion, clubRoles } from './club-confirmation';

export function audienceEvent(event: BridgeEvent, projection?: Projection) {
  const { club } = event;
  const data = {
    clubEnabled: !!club?.enabled,
    id: event.id,
    name: event.name,
    prefix: event.prefix,
    kind: event.kind,
    gameMode: event.gameMode,
    date: event.date,
    venue: event.venue,
    rounds: event.rounds,
    boardsPerRound: event.boardsPerRound,
    maxBoardNumber: event.maxBoardNumber,
    awardPlaces: event.awardPlaces,
    awardDescription: event.awardDescription,
    movementDescription: event.movementDescription,
    movementImported: event.movementImported,
    teamMovement: event.teamMovement,
    byeVp: event.byeVp,
    currentRound: event.currentRound,
    roundPhase: event.roundPhase,
    roundTimes: event.roundTimes,
    status: event.status,
    publishBoards: event.publishBoards,
    pairMethod: event.pairMethod,
    trim: event.trim,
    penalties: event.penalties,
    demo: event.demo,
    participants: event.participants.map(p => ({ id:p.id, name:p.name, players:p.players, captain:p.captain, group:p.group })),
    assignments: event.assignments.map(a => ({ id:a.id, round:a.round, table:a.table, room:a.room, ns:a.ns, ew:a.ew, boards:a.boards, matchId:a.matchId, playerNames:a.playerNames })),
    parentEventId: event.parentEventId,
    stageName: event.stageName,
    hasStages: event.hasStages,
    competition: event.competition,
    revision: event.revision,
    updatedAt: event.updatedAt,
    results: normalizeResults(event.results),
  };
  const visible = club?.enabled ? new Set(event.assignments.filter(a => club.finalized.includes(a.round)).map(a => a.id)) : null;
  const results = visible ? Object.fromEntries(Object.entries(data.results).filter(([, r]) => visible.has(r.assignmentId))) : data.results;
  const safe = { ...data, results };
  // A board can recur in later rounds: keep its deal private until every scheduled use is settled.
  const boards = publicBoards(event).map(b => {
    if (club?.enabled && event.assignments.some(a => a.boards.includes(b.number) && !club.finalized.includes(a.round))) {
      const { deal, ...rest } = { ...b, deal: undefined };
      return { ...rest, published: false };
    }
    return b;
  });
  return { ...safe, boards, collectionProgress: roundProgress(event), projection: !club?.enabled && projection ? projection : project({ ...event, results }) };
}

export function clubView(event: BridgeEvent, pair: string) {
  const round = event.currentRound ?? 0;
  const assignment = event.assignments.find(a => a.round === round && (a.ns === pair || a.ew === pair));
  const roles = assignment ? clubRoles(event, assignment) : null;
  const accepted = !!assignment && clubAccepted(event, assignment);
  return {
    id: event.id, gameMode: event.gameMode ?? 'bridge', name: [event.prefix, event.name].filter(Boolean).join(' '), pair,
    pairName: event.participants.find(p => p.id === pair)?.name ?? pair,
    round, phase: event.roundPhase, status: event.status,
    locked: accepted,
    accepted,
    role: roles ? (roles.inputPair === pair ? 'input' as const : 'confirm' as const) : null,
    roles,
    reviewVersion: assignment ? clubReviewVersion(event, assignment) : '',
    finalized: event.club?.finalized.includes(round) ?? false,
    assignment,
    names: assignment ? { ns: event.participants.find(p => p.id === assignment.ns)?.name, ew: event.participants.find(p => p.id === assignment.ew)?.name } : null,
    boards: assignment ? event.boards.filter(b => assignment.boards.includes(b.number)).map(b => ({ number: b.number, dealer: b.dealer, vulnerability: b.vulnerability, result: event.results[resultKey(assignment.id, b.number)] ?? null })) : [],
  };
}
export type ClubView = ReturnType<typeof clubView>;
