import { clubConfirmationKey } from '../club-confirmation';
import type { MutationContext } from './context';
import type { Mutation } from '../model';
import { resultKey } from '../model';
import { DomainError } from '../domain-error';
import { makeBoard } from '../domain/board-factory';
import {
  currentKnockoutScore,
  knockoutAssignments,
  knockoutBasis,
  knockoutMatchId,
  knockoutSource,
  validateKnockout,
} from '../knockout';
export function applyKnockoutCommand(
  context: MutationContext,
  command: Extract<
    Mutation,
    { action: 'knockout-config' | 'knockout-publish' | 'knockout-decide' | 'knockout-reopen' }
  >,
) {
  const e = context.event;
  if (e.kind !== 'teams' || e.status === 'finished')
    throw new DomainError('請在開放中的隊制賽設定淘汰賽');
  if (command.action === 'knockout-config') {
    if (
      Object.keys(e.results).length ||
      (e.knockout && Object.keys(e.knockout.published).length) ||
      e.swiss?.publications.length
    )
      throw new DomainError('已收分或公布對戰後不能重建對戰表');
    validateKnockout(command.nodes, e);
    e.knockout = { nodes: command.nodes, published: {}, decisions: {} };
    delete e.swiss;
    delete e.teamMovement;
    e.byeVp = 0;
    e.assignments = [];
    e.rounds = Math.max(...command.nodes.map((n) => n.startRound + n.rounds - 1));
    e.boardsPerRound = Math.max(...command.nodes.map((n) => n.boardsPerRound));
    const counts = Array.from({ length: e.rounds }, (_, i) =>
      Math.max(
        0,
        ...command.nodes
          .filter((n) => n.startRound <= i + 1 && i + 1 < n.startRound + n.rounds)
          .map((n) => n.boardsPerRound),
      ),
    );
    e.boards = Array.from(
      { length: counts.reduce((a, b) => a + b, 0) },
      (_, i) =>
        e.boards.find((b) => b.number === i + 1) ?? {
          ...makeBoard(i + 1),
          ...(e.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}),
        },
    );
    e.currentRound = 0;
    e.roundPhase = 'break';
    e.roundTimes = {};
    e.movementImported = true;
    e.movementDescription =
      '隊制淘汰賽：各對局依對戰表指定圈數與牌數；勝方／敗方由裁判確認後公布後續安排。';
    if (e.club) {
      e.club.confirmations = {};
      e.club.finalized = [];
    }
    context.detail = `儲存 ${command.nodes.length} 個對局`;
    return;
  }
  const ko = e.knockout;
  if (!ko) throw new DomainError('請先建立淘汰賽對戰表');
  if (command.action === 'knockout-publish') {
    let count = 0;
    const starts = new Map<number, number>();
    let offset = 1;
    for (let r = 1; r <= e.rounds; r++) {
      starts.set(r, offset);
      offset += Math.max(
        0,
        ...ko.nodes
          .filter((n) => n.startRound <= r && r < n.startRound + n.rounds)
          .map((n) => n.boardsPerRound),
      );
    }
    for (const n of ko.nodes) {
      if (ko.published[n.id]) continue;
      const left = knockoutSource(n.a, ko),
        right = knockoutSource(n.b, ko);
      if (left === undefined || right === undefined) continue;
      if (left === null && right === null) throw new DomainError('對局沒有參賽隊伍');
      if (left === null || right === null) {
        const winner = left ?? right!;
        ko.published[n.id] = { a: winner, b: null };
        ko.decisions[n.id] = { winner, reason: '種子輪空晉級' };
        count++;
        continue;
      }
      if (left === right) throw new DomainError('同隊不可對戰自己');
      for (let round = n.startRound; round < n.startRound + n.rounds; round++) {
        if (
          e.assignments.some(
            (a) =>
              a.round === round &&
              (a.table === n.table || [a.ns, a.ew].some((id) => id === left || id === right)),
          )
        )
          throw new DomainError('公布對局與現有桌次或隊伍時段衝突');
        const matchId = knockoutMatchId(n.id, round),
          boards = Array.from({ length: n.boardsPerRound }, (_, i) => starts.get(round)! + i);
        e.assignments.push(
          {
            id: matchId + 'o',
            matchId,
            round,
            table: n.table,
            room: 'open',
            ns: left,
            ew: right,
            boards,
          },
          {
            id: matchId + 'c',
            matchId,
            round,
            table: n.table,
            room: 'closed',
            ns: right,
            ew: left,
            boards,
          },
        );
      }
      ko.published[n.id] = { a: left, b: right };
      count++;
    }
    if (!count) throw new DomainError('目前沒有已確定雙方、可公布的對局');
    e.assignments.sort(
      (a, b) =>
        a.round - b.round || Number(a.table) - Number(b.table) || a.room.localeCompare(b.room),
    );
    context.detail = `公布 ${count} 個對局（含輪空晉級）`;
    return;
  }
  const n = ko.nodes.find((n) => n.id === command.nodeId);
  if (!n) throw new DomainError('找不到對局');
  if (command.action === 'knockout-reopen') {
    if (!ko.decisions[n.id]) throw new DomainError('這場尚未確認勝負');
    if (!ko.published[n.id]?.b) throw new DomainError('種子輪空不需撤回勝負');
    const descendants = new Set<string>();
    for (const node of ko.nodes)
      if (
        [node.a, node.b].some(
          (s) =>
            (s.kind === 'winner' || s.kind === 'loser') && (s.id === n.id || descendants.has(s.id)),
        )
      )
        descendants.add(node.id);
    const remove = new Set(
      ko.nodes
        .filter((x) => descendants.has(x.id))
        .flatMap((x) => knockoutAssignments(e, x).map((a) => a.id)),
    );
    if (Object.values(e.results).some((r) => remove.has(r.assignmentId)))
      throw new DomainError('後續對局已有成績；請先清除後續成績，再撤回來源勝負');
    if (e.club) {
      for (const a of e.assignments.filter((a) => remove.has(a.id))) {
        delete e.club.confirmations[clubConfirmationKey(e, a)];
        if (e.club.inputOverrides) delete e.club.inputOverrides[a.id];
      }
    }
    e.assignments = e.assignments.filter((a) => !remove.has(a.id));
    for (const id of descendants) {
      delete ko.published[id];
      delete ko.decisions[id];
    }
    delete ko.decisions[n.id];
    context.detail = `撤回 ${n.name} 勝負及 ${descendants.size} 個後續安排`;
    return;
  }
  const p = ko.published[n.id];
  if (!p?.b) throw new DomainError('請先公布這場對局');
  if (ko.decisions[n.id]) throw new DomainError('這場已確認勝負');
  const assignments = knockoutAssignments(e, n);
  if (
    assignments.length !== n.rounds * 2 ||
    assignments.some((a) => a.boards.some((b) => !e.results[resultKey(a.id, b)]))
  )
    throw new DomainError('本對局尚未收齊所有圈次成績');
  if (e.club?.enabled && assignments.some((a) => !e.club!.finalized.includes(a.round)))
    throw new DomainError('請先結算並發布本對局的所有圈次');
  const score = currentKnockoutScore(e, n);
  const expected = score.tied ? undefined : score.a > score.b ? p.a : p.b;
  const winner = command.winner ?? expected;
  if (!winner || ![p.a, p.b].includes(winner))
    throw new DomainError('對局平手，請裁判指定晉級隊伍並填寫決勝原因');
  if (expected && winner !== expected) throw new DomainError('指定隊伍與累計對局成績不符');
  ko.decisions[n.id] = {
    winner,
    loser: winner === p.a ? p.b : p.a,
    basis: knockoutBasis(e, n),
    reason: command.reason,
  };
  context.detail = `${n.name}：${winner} 晉級／勝方，${score.a}：${score.b}`;
}
