import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '../domain-error';
import { BridgeEvent, createSchema } from '../model';
import { buildMovement } from '../movement-plans';
import { makeBoard } from './board-factory';
export function createEvent(
  input: z.infer<typeof createSchema>,
  id: string = randomUUID(),
): BridgeEvent {
  const parsed = createSchema.parse(input),
    data = { ...parsed, rounds: parsed.rounds ?? 0, boardsPerRound: parsed.boardsPerRound ?? 0 },
    now = new Date().toISOString();
  const participants = data.names.map((name, i) => ({
    id: `${data.kind === 'teams' ? 't' : 'p'}${i + 1}`,
    name,
    players: '',
  }));
  const rotation: (string | null)[] = participants.map((p) => p.id);
  if (rotation.length % 2) rotation.push(null);
  const e: BridgeEvent = {
    id,
    name: data.name,
    prefix: data.prefix ?? '',
    ...(data.firstStageName ? { hasStages: true, stageName: data.firstStageName } : {}),
    kind: data.kind,
    ...(data.kind==='pairs'?{rankingMode:data.rankingMode??(data.movementPlan?'double':'single')}:{ }),
    ...(data.kind === 'teams' ? { teamMethod: data.teamMethod ?? 'imp', ...(data.teamMethod === 'bam' ? { bam: data.bam ?? {win:2,draw:1,loss:0} } : {}) } : {}),
    ...(data.kind === 'teams' && participants.length % 2 ? { byeVp: data.teamMethod === 'bam' ? 0 : 12 } : {}),
    maxBoardNumber: data.kind === 'pairs' ? 0 : 32,
    gameMode: data.gameMode ?? 'bridge',
    date: data.date,
    ...(data.endDate ? { endDate: data.endDate } : {}),
    venue: data.venue,
    ...(data.venueOverride !== undefined ? { venueOverride: data.venueOverride } : {}),
    rounds: data.rounds,
    boardsPerRound: data.boardsPerRound,
    status: 'live',
    publishBoards: false,
    pairMethod: data.pairMethod ?? 'mp',
    neuberg: data.neuberg ?? false,
    trim: data.kind === 'pairs' && data.pairMethod !== 'mp' ? (data.trim ?? 'none') : 'none',
    penalties: {},
    demo: false,
    participants,
    boards: Array.from({ length: data.rounds * data.boardsPerRound }, (_, i) => ({
      ...makeBoard(i + 1),
      ...(data.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}),
    })),
    assignments: [],
    results: {},
    audit: [],
    revision: 1,
    updatedAt: now,
  };
  // Rotation repeats after each full cycle, with fresh boards and IDs every round.
  // Every active table plays the same board set that round.
  // Pairs events therefore require duplicate board sets, not a physical Mitchell movement.
  for (let round = 1; round <= data.rounds; round++) {
    const boards = Array.from(
      { length: data.boardsPerRound },
      (_, i) => (round - 1) * data.boardsPerRound + i + 1,
    );
    let table = 0;
    for (let i = 0; i < rotation.length / 2; i++) {
      let a = rotation[i],
        b = rotation[rotation.length - 1 - i];
      if (!a || !b) continue;
      if ((round + i) % 2 === 0) [a, b] = [b, a];
      if (data.kind === 'teams' && Number(a.slice(1)) > Number(b.slice(1))) [a, b] = [b, a];
      table++;
      const matchId = `r${round}m${table}`;
      e.assignments.push({
        id: `${matchId}o`,
        round,
        table,
        room: data.kind === 'teams' ? 'open' : 'pairs',
        ns: a,
        ew: b,
        boards,
        matchId,
      });
      if (data.kind === 'teams')
        e.assignments.push({
          id: `${matchId}c`,
          round,
          table,
          room: 'closed',
          ns: b,
          ew: a,
          boards,
          matchId,
        });
    }
    rotation.splice(1, 0, rotation.pop()!);
  }
  if ((data.movementPlan || data.rankingMode === 'double') && !data.rounds) {
    e.participants = e.participants.map((p, i) => ({
      ...p,
      group: i < e.participants.length / 2 ? 'NS' : 'EW',
    }));
  }
  if (data.movementPlan && data.rounds) {
    const plan = (() => {
      try {
        return buildMovement(e, data.movementPlan);
      } catch (error) {
        throw new DomainError((error as Error).message);
      }
    })();
    e.participants = plan.participants;
    e.assignments = plan.assignments;
    e.boards = Array.from({ length: plan.boardCount }, (_, i) => ({
      ...makeBoard(i + 1),
      group: `Movement-${Math.floor(i / e.boardsPerRound) + 1}`,
      ...(e.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}),
    }));
    e.movementImported = true;
    e.movementDescription = `${plan.option.label}；${plan.option.note}`;
  }
  // New events have no real deals until PBN import. Use empty hands instead of generated ones.
  e.boards = e.boards.map((b) => ({ ...b, deal: { N: [], E: [], S: [], W: [] } }));
  e.audit = [
    {
      at: now,
      action: '建立賽事',
      reason: data.rounds ? '固定圈次賽程' : '待設定賽程',
      revision: 1,
    },
  ];
  return e;
}
