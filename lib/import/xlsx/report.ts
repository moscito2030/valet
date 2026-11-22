import type { ImportData } from './import';

export function importReport(data: ImportData, showNames: boolean) {
  const { event, competition, projection } = data;
  const mismatchCountByCategory = { 'source-internal': 0, 'ranking-convention': 0, scoring: 0 };
  for (const { category } of data.differences) mismatchCountByCategory[category]++;
  return {
    format: data.format,
    scheduleSources: data.scheduleSources,
    competition: {
      name: competition.competition.name,
      venue: competition.competition.venue,
      archived: competition.competition.archived,
    },
    stage: {
      name: event.stageName,
      status: event.status,
      kind: event.kind,
      format: data.format.adopted,
      teamFormat: event.teamFormat,
      scoring: 'IMP → VP',
      rounds: event.rounds,
      boardsPerRound: event.boardsPerRound,
      organizerAssigned: Boolean(event.organizerId),
    },
    sheetCount: data.sheetCount,
    teams: data.roster.length,
    people: new Set(
      data.roster.flatMap(({ names, participant }) => [
        ...names,
        ...(participant.captain ? [participant.captain] : []),
      ]),
    ).size,
    roster: data.roster.map(({ team, names, participant }) => ({
      team,
      people: new Set([...names, ...(participant.captain ? [participant.captain] : [])]).size,
      ...(showNames ? { names, captain: participant.captain } : {}),
    })),
    ...(showNames
      ? { lineups: event.assignments.map(({ id, playerNames }) => ({ id, playerNames })) }
      : {}),
    matches: projection.matches.length,
    assignments: event.assignments.length,
    boards: event.boards.length,
    boardsWithDeals: event.boards.filter((board) => Object.values(board.deal).flat().length === 52)
      .length,
    boardsPublished: event.boards.filter((board) => board.published).length,
    results: projection.received,
    expectedResults: projection.expected,
    originalBoardByRound: Object.fromEntries(
      Array.from({ length: event.rounds }, (_, i) => [
        `R${i + 1}`,
        data.boardMapping
          .filter((item) => item.round === i + 1)
          .map((item) => `${item.original}→${item.board}`)
          .join('、'),
      ]),
    ),
    repeatedOriginalBoardDeals: data.repeatedDeals,
    contractStyles: data.styles,
    sourceContractStylesIncludingDuplicateViews: data.sourceStyles,
    penalties: Object.entries(event.penalties ?? {}).map(([team, vp]) => ({
      team: Number(team.slice(1)),
      vp,
    })),
    assumptions: [
      'RoundRobin 負 COP 視為 VP 罰分',
      '每對姓名依來源順序分配 N/S 或 E/W',
      'A 對應 average；VALET 投影將其視為取消，全場逐副取消時不發 VP',
    ],
    comparisons: data.checks,
    mismatchCount: data.differences.length,
    mismatchCountByCategory,
    rankingConvention: {
      rule: '以檔案逐輪勝分加總（未扣 COP）降冪排序，同分並列且跳過後續名次',
      ...data.rankingConvention,
    },
    mismatches: data.differences,
    unmapped: data.unmapped,
  };
}
