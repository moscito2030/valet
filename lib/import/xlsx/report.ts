import type { ImportData } from './import';

export function importReport(data: ImportData, showNames: boolean) {
  const { event, competition, projection } = data;
  const mismatchCountByCategory = {
    'source-internal': 0,
    'ranking-convention': 0,
    scoring: 0,
    'expected-by-decision': 0,
  };
  for (const { category } of data.differences) mismatchCountByCategory[category]++;
  const standings = projection.standings.map((standing) => {
    const team = Number(standing.id.slice(1));
    const original = data.finalStandings.get(team);
    const reasons = [
      ...new Set(
        data.differences
          .filter(
            (difference) =>
              difference.team === team &&
              ['total VP', 'rank', 'total IMP won', 'total IMP lost'].includes(difference.field),
          )
          .map((difference) => difference.category),
      ),
    ];
    return {
      team,
      name: standing.name,
      valetRank: standing.rank,
      valetVp: standing.score == null ? null : Number(standing.score.toFixed(2)),
      includesProvisional: !!standing.provisional,
      fileRank: original?.rank ?? null,
      fileVp: original?.vp == null ? null : Number(original.vp.toFixed(2)),
      vpDifference:
        original?.vp == null || standing.score == null
          ? null
          : Number((standing.score - original.vp).toFixed(2)),
      reasons,
      ...(reasons.includes('expected-by-decision')
        ? { decision: 'Edgar 決定：省略指定場次成績或 COP，依指定方式暫定或留空' }
        : {}),
    };
  });
  return {
    ...(!event.date ? { warnings: ['缺少 --date，正式匯入必須提供賽事日期'] } : {}),
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
      archived: event.stageArchived,
      date: event.date || null,
      endDate: event.endDate,
      maxBoardNumber: event.maxBoardNumber,
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
    displayBoardByRound: Object.fromEntries(
      Array.from({ length: event.rounds }, (_, i) => [
        `R${i + 1}`,
        data.boardDisplayMapping
          .filter((item) => item.round === i + 1)
          .map((item) => `${item.board}→${item.displayed}→${item.original}`),
      ]),
    ),
    skippedCop: [...data.skippedCop].map(([team, cop]) => ({ team, cop })),
    finalStandings: standings,
    provisionalMatches: data.decisionValues.map((match) => ({
      round: match.round,
      table: match.table,
      teams: match.teams,
      decision: 'Edgar 決定',
      storage: {
        table: 'bridge_stages',
        column: 'settings',
        field: `provisionalVp.${match.id}`,
        value: { vp: match.vp },
        initialResultRows: 0,
      },
      publicDisplay: match.vp
        ? `${match.vp.join(':')}（暫定）；兩隊總分標示「含暫定」`
        : '場次 VP 留空，待補登成績',
      ...(event.stageArchived ? { visibility: '目前封存，須解除封存才公開' } : {}),
      entryWorkflow: [
        '在進行中的賽段選擇該輪、該桌與房間，逐副補登開室和閉室成績。',
        '兩室成績收齊（含取消）後自動改用實際 VP，裁判也可先移除暫定 VP。',
        '全段收齊後進入成績覆核，再由裁判結束賽段。',
      ],
      matchVp: match.teams.map((team, index) => ({
        team,
        file: match.fileVp[index],
        valet: match.vp?.[index] ?? null,
      })),
      standingsImpact: standings.filter(
        (team) =>
          match.teams.includes(team.team) ||
          (team.fileRank !== team.valetRank && team.reasons.includes('expected-by-decision')),
      ),
    })),
    penalties: Object.entries(event.penalties ?? {}).map(([team, vp]) => ({
      team: Number(team.slice(1)),
      vp,
    })),
    ...(data.decisionValues.length
      ? { decision: 'expected-by-decision 來自 Edgar 對指定場次的決定' }
      : {}),
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
