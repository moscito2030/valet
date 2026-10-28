import { knockoutRoundReady } from '../knockout';
import { DomainError } from '../domain-error';
import { makeBoard } from '../domain/board-factory';
import { exportMovement, parseByeVp, parseMovement } from '../imports';
import { Mutation, resultKey } from '../model';
import { buildMovement } from '../movement-plans';
import { parseRoundTimes } from '../round-times-import';
import { playerBoardError } from '../schedule-limits';
import { assertSwissTeams, publishSwiss, swissRoundComplete } from '../swiss';
import { isInterleaved } from '../team-movement';
import { nextScheduledRound, previousScheduledRound, roundHasActivity, unsettledRoundsBefore } from '../round-workflow';
import { readyBoardGroups } from '../board-publication-ready';
import { boardRange } from '../board-groups';
import type { MutationContext } from './context';

export function applyScheduleCommand(
  context: MutationContext,
  command: Extract<
    Mutation,
    {
      action:
        | 'round-control'
        | 'round-times-import'
        | 'round-timing'
        | 'swiss-config'
        | 'swiss-publish'
        | 'movement-plan'
        | 'movement';
    }
  >,
) {
  const { event: e, at, changes } = context;
  let detail: string | undefined;
  if (e.teamFormat === 'knockout' && ['swiss-config', 'movement', 'movement-plan'].includes(command.action)) throw new DomainError('純 IMP 淘汰賽請至「淘汰賽」設定對戰表');
  if (command.action === 'round-control') {
    if (e.status !== 'live') throw new DomainError('賽段已進入覆核或結束，請直接由裁判更正成績，不能調整圈次。');
    if (e.club?.enabled) {
      const current = e.currentRound ?? 0;
      if (command.round > current) {
        if (command.round !== nextScheduledRound(e, current)) throw new DomainError('請依序開始下一圈，不可跳圈。');
        if (unsettledRoundsBefore(e, command.round).length)
          throw new DomainError('尚有前圈未結算，請先處理未完成桌次並結算；不能直接開始下一圈。');
      }
      if (command.round < current &&
        (command.round !== previousScheduledRound(e, current) || roundHasActivity(e, current) ||
          (command.round > 0 && command.phase !== 'break')))
        throw new DomainError('本圈已有登分或處理紀錄，不能退圈；請暫停收分或由裁判更正。');
      if (command.round > 0 && command.phase === 'playing' && e.club.finalized.includes(command.round))
        throw new DomainError('本圈已結算，請開始下一圈；更正成績不需要重新開圈。');
    }
    if (!knockoutRoundReady(e, command.round))
      throw new DomainError('請先公布這一圈所有淘汰賽對局');
    if (
      e.swiss &&
      command.round > 0 &&
      command.phase === 'playing' &&
      !swissRoundComplete(e, command.round)
    )
      throw new DomainError('請先完整公布這一圈對戰與輪空');
    if (command.round > e.rounds) throw new DomainError('圈數超過賽程範圍');
    if (command.round > 0 && !e.assignments.some((a) => a.round === command.round))
      throw new DomainError('請先安排這一圈的賽程');
    detail = `${e.currentRound ?? 0} → ${command.round}；${command.phase === 'break' ? '圈間休息' : '進行中'}`;
    if (command.publishGroups?.length) {
      if (command.round !== (e.currentRound ?? 0) + 1 || command.phase !== 'playing')
        throw new DomainError('請在開始下一圈時確認公開牌型。');
      const eligible = readyBoardGroups(e);
      const groups = [...new Set(command.publishGroups)].map(number => eligible.find(g => g[0].number === number));
      if (groups.some(g => !g)) throw new DomainError('牌群尚未全部完成，或公開狀態已變更，請重新載入後核對。');
      for (const group of groups) for (const board of group!) board.published = true;
      detail += `；公開牌型 ${boardRange(groups.flatMap(g => g!.map(b => b.number)))}`;
    }
    e.currentRound = command.round;
    e.roundPhase = command.phase;
  } else if (command.action === 'round-times-import') {
    try {
      const rows = parseRoundTimes(command.csv, e);
      e.roundTimes ??= {};
      for (const row of rows) {
        if (row.startAt && row.endAt)
          e.roundTimes[row.round] = { startAt: row.startAt, endAt: row.endAt };
        else delete e.roundTimes[row.round];
      }
      detail = rows
        .map((row) => `第 ${row.round} 圈：${row.startAt ?? '清除'} — ${row.endAt ?? '清除'}`)
        .join('；');
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
  } else if (command.action === 'round-timing') {
    if (command.round > e.rounds) throw new DomainError('圈數超過賽程範圍');
    if ((command.startAt === null) !== (command.endAt === null))
      throw new DomainError('開始與結束時間需一起填寫或一起清除');
    if (
      command.startAt &&
      command.endAt &&
      Date.parse(command.endAt) <= Date.parse(command.startAt)
    )
      throw new DomainError('結束時間必須晚於開始時間');
    e.roundTimes ??= {};
    if (command.startAt && command.endAt)
      e.roundTimes[command.round] = { startAt: command.startAt, endAt: command.endAt };
    else delete e.roundTimes[command.round];
    detail = `第 ${command.round} 圈：${command.startAt ?? '未設定'} — ${command.endAt ?? '未設定'}`;
  } else if (command.action === 'swiss-config') {
    assertSwissTeams(e);
    if (e.teamMethod !== 'bam' && command.byeVp > 20)
      throw new DomainError('IMP／VP 輪空分不可超過 20');
    if (e.status !== 'live' || Object.keys(e.results).length || e.swiss?.publications.length)
      throw new DomainError('Swiss 模式須在收分與公布對戰前設定');
    const error = playerBoardError(command.rounds, command.boardsPerRound);
    if (error) throw new DomainError(error);
    const maxRounds = e.participants.length % 2 ? e.participants.length : e.participants.length - 1;
    if (command.rounds > maxRounds)
      throw new DomainError(`不重複對手的 Swiss 最多 ${maxRounds} 圈`);
    e.rounds = command.rounds;
    e.boardsPerRound = command.boardsPerRound;
    e.byeVp = command.byeVp;
    e.swiss = { mode: command.mode, publications: [] };
    e.assignments = [];
    e.boards = Array.from(
      { length: e.rounds * e.boardsPerRound },
      (_, i) =>
        e.boards.find((b) => b.number === i + 1) ?? {
          ...makeBoard(i + 1),
          deal: { N: [], E: [], S: [], W: [] },
          published: false,
        },
    );
    e.currentRound = 0;
    e.roundPhase = 'break';
    e.roundTimes = {};
    e.movementImported = true;
    e.movementDescription = `Swiss · ${command.mode === 'current' ? '當圈安排' : '隔圈安排'} · 依未扣判罰的累計 VP 配對，不重複對手`;
    detail = e.movementDescription;
  } else if (command.action === 'swiss-publish') {
    detail = publishSwiss(e, command.round, command.partial, at);
  } else if (command.action === 'movement-plan') {
    if (e.status === 'finished' || Object.keys(e.results).length || e.club?.finalized.length)
      throw new DomainError('僅能在尚未收分且未結束的賽段套用賽程編排');
    try {
      e.rounds = command.rounds ?? e.rounds;
      e.boardsPerRound = command.boardsPerRound ?? e.boardsPerRound;
      if (
        command.byeVp !== undefined &&
        (e.kind !== 'teams' ||
          e.participants.length % 2 === 0 ||
          command.plan !== 'team-round-robin')
      )
        throw new Error('僅奇數隊輪空編排可設定輪空 VP');
      if (command.byeVp !== undefined && e.teamMethod !== 'bam' && command.byeVp > 20)
        throw new DomainError('IMP／VP 輪空分不可超過 20');
      if (command.byeVp !== undefined) e.byeVp = command.byeVp;
      const plan = buildMovement(
        e,
        command.plan,
        command.interleavedGroups,
        command.arrowSwitchRound,
        command.movementFile,
        command.pairMovement,
      );
      e.boards = Array.from({ length: plan.boardCount }, (_, i) => {
        const old = e.boards.find((b) => b.number === i + 1);
        return {
          ...(old ?? {
            ...makeBoard(i + 1),
            deal: { N: [], E: [], S: [], W: [] },
            published: false,
          }),
          group: `Movement-${Math.floor(i / e.boardsPerRound) + 1}`,
          ...(e.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}),
        };
      });
      e.participants = plan.participants;
      if(e.kind==='pairs') e.rankingMode=plan.participants.some(p=>p.group)?'double':'single';
      parseMovement(exportMovement({ ...e, assignments: plan.assignments }), e);
      e.assignments = plan.assignments;
      e.teamMovement = plan.option.interleavedSize ? 'interleaved' : undefined;
      e.movementImported = true;
      e.movementDescription = `${plan.option.label}；${plan.option.note}${plan.byes.length ? `輪空每圈 ${e.byeVp ?? 12} VP。` : ''}${plan.shared ? '同圈有共用牌組，請準備複製牌或安排共牌。' : ''}`;
      e.roundTimes = {};
      e.currentRound = 0;
      e.roundPhase = 'break';
      if (e.club) {
        e.club.confirmations = {};
        e.club.inputOverrides = {};
      }
      detail = e.movementDescription;
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
  } else if (command.action === 'movement') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    try {
      const incoming = parseMovement(command.csv, e);
      const byeVp = e.kind === 'teams' ? parseByeVp(command.csv) : undefined;
      if (byeVp !== undefined) {
        if (byeVp !== (e.byeVp ?? 12) && Object.keys(e.results).length)
          throw new Error('已有成績，不可變更輪空 VP');
        detail = `輪空 VP：${e.byeVp ?? 12} → ${byeVp}`;
        e.byeVp = byeVp;
      }
      if (
        (isInterleaved(incoming) || isInterleaved(e.assignments)) &&
        Object.keys(e.results).length
      )
        throw new Error('交錯循環已有成績，不可重新匯入賽程');
      const rounds = new Set(incoming.map((a) => a.round));
      const scoredRounds = new Set(
        e.assignments
          .filter((a) => a.boards.some((b) => e.results[resultKey(a.id, b)]))
          .map((a) => a.round),
      );
      for (const a of incoming) {
        if (!scoredRounds.has(a.round)) continue;
        const old = e.assignments.find(
          (item) =>
            item.round === a.round &&
            String(item.table) === String(a.table) &&
            item.room === a.room,
        );
        if (
          !old ||
          old.ns !== a.ns ||
          old.ew !== a.ew ||
          [...old.boards].sort((x, y) => x - y).join(',') !==
            [...a.boards].sort((x, y) => x - y).join(',')
        )
          throw new Error(`第 ${a.round} 圈已有成績，不可改動其賽程`);
        a.id = old.id;
        a.matchId = old.matchId;
        a.playerNames = old.playerNames;
      }
      const combined = [
        ...e.assignments.filter(
          (a) =>
            !rounds.has(a.round) &&
            (e.kind === 'teams' || e.movementImported || scoredRounds.has(a.round)),
        ),
        ...incoming,
      ];
      parseMovement(exportMovement({ ...e, assignments: combined }), e);
      e.assignments = combined.sort(
        (a, b) =>
          a.round - b.round ||
          String(a.table).localeCompare(String(b.table), 'en', { numeric: true }),
      );
      e.movementImported = true;
      e.teamMovement = isInterleaved(e.assignments) ? 'interleaved' : undefined;
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
  }
  context.detail = detail;
}
