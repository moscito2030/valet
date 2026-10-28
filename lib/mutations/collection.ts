import { knockoutExemptAssignments } from '../knockout-status';
import { knockoutRoundReady } from '../knockout';
import {
  clubAccepted,
  clubAssignmentFinalized,
  clubConfirmationKey,
  clubReviewVersion,
  clubRoles,
} from '../club-confirmation';
import { DomainError } from '../domain-error';
import { Mutation, Result, resultKey } from '../model';
import { swissRoundComplete } from '../swiss';
import { deviceAssignment, tableDevices, validDeviceSchedule } from '../table-device';
import type { MutationContext } from './context';
import { scoredInput } from './scored-input';
import { nextScheduledRound, roundStartProblem, unsettledRoundsBefore } from '../round-workflow';

export function applyCollectionCommand(
  context: MutationContext,
  command: Extract<
    Mutation,
    { action: 'club-config' | 'club-play' | 'club-finalize' | 'club-complete-table' }
  >,
) {
  const { event: e, at, changes } = context;
  let detail: string | undefined;
  if (command.action === 'club-config') {
    if ((command.enabled || command.tokenHash) && (!e.participants.length || !e.assignments.length)) throw new DomainError('請先完成參賽名單與賽程編排，再啟用收分或簽發連結');
    const mode = command.mode ?? e.club?.mode ?? 'pair';
    if (e.kind !== 'pairs' && mode !== 'table') throw new DomainError('隊制賽請使用大賽收分模式');
    if (mode === 'table' && !validDeviceSchedule(e))
      throw new DomainError('同圈同桌有多筆安排，請先修正桌號／開閉室');
    if (
      mode !== (e.club?.mode ?? 'pair') &&
      (Object.keys(e.results).length || e.club?.finalized.length)
    )
      throw new DomainError('收分後不可切換裝置綁定模式');
    if (mode !== (e.club?.mode ?? 'pair') && e.club?.enabled && command.enabled)
      throw new DomainError('請先停用裝置收分再切換模式');
    e.club ??= { enabled: false, tokens: {}, confirmations: {}, finalized: [] };
    if (mode !== (e.club.mode ?? 'pair')) {
      e.club.tokens = {};
      e.club.confirmations = {};
    }
    e.club.mode = mode;
    e.club.enabled = command.enabled;
    if (command.inputRule !== undefined || command.assignmentId !== undefined) {
      if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
      const previous = new Map(e.assignments.map((a) => [a.id, clubRoles(e, a).inputPair]));
      if (command.inputRule !== undefined) {
        // Keep settled tables' historical roles when changing future input rules.
        e.club.inputOverrides ??= {};
        for (const a of e.assignments) {
          if (clubAssignmentFinalized(e, a)) e.club.inputOverrides[a.id] = previous.get(a.id)!;
        }
        e.club.inputRule = command.inputRule;
      }
      if (command.assignmentId !== undefined) {
        const a = e.assignments.find((a) => a.id === command.assignmentId);
        if (!a || clubAssignmentFinalized(e, a)) throw new DomainError('桌次不存在或已結算');
        if (command.inputPair !== null && command.inputPair !== a.ns && command.inputPair !== a.ew)
          throw new DomainError('輸入方必須是該桌搭檔');
        e.club.inputOverrides ??= {};
        if (command.inputPair === null) delete e.club.inputOverrides[a.id];
        else e.club.inputOverrides[a.id] = command.inputPair;
      }
      for (const a of e.assignments) {
        if (e.club.finalized.includes(a.round)) continue;
        if (previous.get(a.id) !== clubRoles(e, a).inputPair) {
          delete e.club.confirmations[clubConfirmationKey(e, a)];
          delete e.club.confirmations[`${a.round}:${a.ns}`];
          delete e.club.confirmations[`${a.round}:${a.ew}`];
        }
      }
      detail = command.assignmentId
        ? `設定桌次 ${command.assignmentId} 輸入方：${command.inputPair ?? '依全局規則'}`
        : `設定輸入規則：${command.inputRule}`;
    }
    if (command.participantId) {
      if (mode !== 'pair') throw new DomainError('大賽模式請簽發桌次連結');
      if (!e.participants.some((p) => p.id === command.participantId) || !command.tokenHash)
        throw new DomainError('搭檔或連結無效');
      e.club.tokens[command.participantId] = command.tokenHash;
      detail = '重新簽發 ' + command.participantId + ' 輸入連結；舊連結失效';
    }
    if (command.deviceKey) {
      if (
        mode !== 'table' ||
        !command.tokenHash ||
        !tableDevices(e).some((d) => d.key === command.deviceKey)
      )
        throw new DomainError('桌次連結無效，請先公布賽程');
      e.club.tokens[command.deviceKey] = command.tokenHash;
      detail = '重新簽發桌次 ' + command.deviceKey + ' 收分連結；舊連結失效';
    }
  } else if (command.action === 'club-play') {
    const club = e.club;
    const pair = Object.entries(club?.tokens ?? {}).find(
      ([, hash]) => hash === command.tokenHash,
    )?.[0];
    if (!club?.enabled || !pair) throw new DomainError('連結無效或收分模式未開啟', 403);
    if (
      e.status !== 'live' ||
      command.round !== e.currentRound ||
      e.roundPhase === 'break' ||
      club.finalized.includes(command.round)
    )
      throw new DomainError('目前不開放此圈輸入', 409);
    const tableMode = club.mode === 'table';
    const a = tableMode
      ? deviceAssignment(e, pair, command.round)
      : e.assignments.find((a) => a.round === command.round && (a.ns === pair || a.ew === pair));
    if (!a)
      throw new DomainError(
        tableMode ? '本圈尚無可收分安排，請等待裁判' : '本圈輪空或尚未安排，無需提交',
      );
    if (clubAssignmentFinalized(e, a)) throw new DomainError('本桌已結算，不開放裝置輸入', 409);
    const { inputPair, confirmPair } = clubRoles(e, a);
    const confirmation = clubConfirmationKey(e, a);
    if (clubAccepted(e, a)) throw new DomainError('本桌已確認，本圈輸入已鎖定', 403);
    if (command.confirm) {
      if (!tableMode && pair !== confirmPair)
        throw new DomainError('輸入方不可確認，請由對方確認', 403);
      if (command.result) throw new DomainError('確認不可同時提交成績');
      if (a.boards.some((b) => !e.results[resultKey(a.id, b)]))
        throw new DomainError('尚有未輸入的牌，請完成後確認');
      if (command.reviewVersion !== clubReviewVersion(e, a))
        throw new DomainError('本桌成績或分工已更新，請重新檢查後確認', 409);
      club.confirmations[confirmation] = {
        at,
        forced: false,
        reviewVersion: command.reviewVersion,
      };
      detail = pair + ' 確認第 ' + command.round + ' 圈';
    } else {
      if (!tableMode && pair !== inputPair) throw new DomainError('只能由指定輸入方輸入成績', 403);
      const r = command.result;
      if (!r || r.assignmentId !== a.id || !a.boards.includes(r.board))
        throw new DomainError('只能輸入本收分卡當圈成績', 403);
      const b = e.boards.find((b) => b.number === r.board)!;
      const key = resultKey(a.id, b.number);
      if (e.results[key]?.split)
        throw new DomainError('請先由裁判撤銷不平衡合約，再更正原始成績', 403);
      if (e.results[key]?.status === 'cancelled')
        throw new DomainError('取消的牌只能由裁判恢復', 403);
      const after = { ...scoredInput(r, e, b), status: 'played' as const, updatedAt: at };
      changes.push({ key, before: e.results[key] ?? null, after });
      e.results[key] = after;
      detail = pair + ' 提交第 ' + command.round + ' 圈';
    }
  } else if (command.action === 'club-complete-table') {
    const club = e.club;
    const a = e.assignments.find((a) => a.id === command.assignmentId && a.round === command.round);
    if (
      !club?.enabled ||
      e.status !== 'live' ||
      command.round !== e.currentRound ||
      club.finalized.includes(command.round) ||
      !a ||
      clubAssignmentFinalized(e, a)
    )
      throw new DomainError('此桌無法取消剩餘牌並確認');
    if (clubAccepted(e, a)) throw new DomainError('本桌已認可');
    let cancelled = 0;
    for (const board of a.boards) {
      const key = resultKey(a.id, board);
      if (e.results[key]) continue;
      const after: Result = {
        assignmentId: a.id,
        board,
        level: 0,
        strain: 'NT',
        doubled: 1,
        declarer: 'N',
        tricks: 0,
        lead: '',
        status: 'cancelled',
        nsScore: 0,
        updatedAt: at,
      };
      changes.push({ key, before: null, after });
      e.results[key] = after;
      cancelled++;
    }
    club.confirmations[clubConfirmationKey(e, a)] = {
      at,
      forced: true,
      reviewVersion: clubReviewVersion(e, a),
    };
    detail = `第 ${command.round} 圈桌次 ${a.id}：取消 ${cancelled} 副未輸入牌並由裁判確認；保留已有成績`;
  } else if (command.action === 'club-finalize') {
    const nextRound = nextScheduledRound(e, command.round);
    if (command.advance) {
      if (command.round !== e.currentRound) throw new DomainError('補結算不得移動目前圈次。');
      const problem = roundStartProblem(e, nextRound);
      if (problem) throw new DomainError(problem);
      if (unsettledRoundsBefore(e, command.round).length)
        throw new DomainError('尚有更早圈次未結算，請先補結算。');
    }
    if (!knockoutRoundReady(e, command.round))
      throw new DomainError('請先公布這一圈所有淘汰賽對局');
    const club = e.club;
    if (
      !club?.enabled ||
      e.status !== 'live' ||
      command.round > (e.currentRound ?? 0) ||
      club.finalized.includes(command.round)
    )
      throw new DomainError('此圈無法結算');
    const assignments = e.assignments.filter((a) => a.round === command.round);
    if (!assignments.length) throw new DomainError('此圈尚未安排賽程');
    if (e.swiss && !swissRoundComplete(e, command.round))
      throw new DomainError('Swiss 本圈尚未完整公布，不能結算');
    const exempt = knockoutExemptAssignments(e);
    for (const a of assignments) {
      if (exempt.has(a.id) || clubAssignmentFinalized(e, a)) continue;
      const accepted = clubAccepted(e, a);
      if (!accepted && !command.force) throw new DomainError('尚有桌次未收齊成績或對方未確認');
      for (const board of a.boards) {
        const key = resultKey(a.id, board);
        if (!e.results[key]) {
          if (!command.force) throw new DomainError('尚有成績未收齊');
          const after: Result = {
            assignmentId: a.id,
            board,
            level: 0,
            strain: 'NT',
            doubled: 1,
            declarer: 'N',
            tricks: 0,
            lead: '',
            status: 'cancelled',
            nsScore: 0,
            updatedAt: at,
          };
          changes.push({ key, before: null, after });
          e.results[key] = after;
        }
      }
      if (!accepted)
        club.confirmations[clubConfirmationKey(e, a)] = {
          at,
          forced: true,
          reviewVersion: clubReviewVersion(e, a),
        };
    }
    club.finalized.push(command.round);
    club.publishedAssignments = club.publishedAssignments?.filter((id) => !assignments.some((a) => a.id === id));
    const isCurrentRound = command.round === e.currentRound;
    if (isCurrentRound) e.roundPhase = 'break';
    if (
      isCurrentRound &&
      (command.advance ?? command.force) &&
      !unsettledRoundsBefore(e, nextRound).length &&
      command.round < e.rounds &&
      e.assignments.some((a) => a.round === nextRound) &&
      (!e.swiss || swissRoundComplete(e, nextRound)) &&
      knockoutRoundReady(e, nextRound)
    ) {
      e.currentRound = nextRound;
      e.roundPhase = 'playing';
    }
    detail =
      '第 ' + command.round + ' 圈結算並發布' + (command.force ? '（強制確認並取消未收牌）' : '');
    if (!isCurrentRound) detail += `；保留目前第 ${e.currentRound} 圈狀態`;
    else if (e.currentRound !== command.round) detail += `；第 ${e.currentRound} 圈開始進行`;
  }
  context.detail = detail;
}
