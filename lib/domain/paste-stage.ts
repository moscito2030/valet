import { randomUUID } from 'node:crypto';
import { materializeBoardPublication } from '../board-publication';
import type { BridgeEvent } from '../model';
import { pasteStageItems, type Include } from '../paste-stage-input';

export function pasteStage(
  source: BridgeEvent,
  { name, include, sameCompetition }: { name: string; include: Include; sameCompetition: boolean },
): BridgeEvent {
  const snapshot = structuredClone(source) as BridgeEvent & { publishBoards?: boolean };
  const stage = 'publishBoards' in snapshot ? materializeBoardPublication(snapshot) : snapshot;
  stage.id = randomUUID();
  stage.name = name;
  stage.stageName = name;
  stage.demo = false;
  stage.stageArchived = false;
  stage.revision = 1;
  stage.updatedAt = new Date().toISOString();
  delete stage.competition;
  delete stage.hasStages;
  delete stage.stageOrder;
  delete stage.parentEventId;
  delete stage.organizerId;
  if (!sameCompetition) {
    delete stage.venueOverride;
    stage.venue = '';
  }

  if (!include.setup) {
    stage.rounds = 0;
    stage.boardsPerRound = 0;
    stage.maxBoardNumber = stage.kind === 'pairs' ? 0 : 32;
    stage.assignments = [];
    delete stage.movementDescription;
    delete stage.movementImported;
    delete stage.teamMovement;
    delete stage.swiss;
    delete stage.knockout;
    delete stage.club;
    delete stage.awardPlaces;
    delete stage.awardPlacesNS;
    delete stage.awardPlacesEW;
    delete stage.awardDescription;
    delete stage.winAward;
    delete stage.audienceRefreshSeconds;
    delete stage.danmakuDefaultEnabled;
    delete stage.showScoreCandles;
  }
  if (!include.roster) {
    stage.participants = include.setup
      ? stage.participants.map(({ id, group }, index) => ({
          id,
          ...(group ? { group } : {}),
          name: `第 ${index + 1} ${stage.kind === 'pairs' ? '對' : '隊'}`,
          players: '',
        }))
      : [];
    for (const assignment of stage.assignments) delete assignment.playerNames;
  }

  if (stage.club) stage.club.tokens = {};
  if (!include.results) {
    stage.results = {};
    stage.penalties = {};
    stage.status = 'live';
    delete stage.currentRound;
    delete stage.roundPhase;
    delete stage.roundTimes;
    if (stage.club) {
      stage.club.confirmations = {};
      stage.club.finalized = [];
      delete stage.club.publishedAssignments;
    }
    if (stage.knockout) stage.knockout.decisions = {};
    for (const publication of stage.swiss?.publications ?? []) {
      publication.basis = [];
      publication.byeBasis = [];
      publication.scores = [];
    }
  }
  if (!include.boards && !include.setup) stage.boards = [];
  for (const board of stage.boards) {
    if (!include.results) board.published = false;
    if (!include.boards) board.deal = { N: [], E: [], S: [], W: [] };
  }

  const items = (Object.keys(pasteStageItems) as (keyof Include)[])
    .filter((key) => include[key])
    .map((key) => pasteStageItems[key]);
  stage.audit = [{
    at: stage.updatedAt,
    action: '貼上賽段',
    reason: '自既有賽段貼上',
    revision: 1,
    detail: `來源賽段 ${source.id}，版本 ${source.revision}；帶入：${items.join('、')}`,
  }];
  return stage;
}
