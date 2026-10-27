import { clubConfirmationKey } from '../club-confirmation';
import type { MutationContext } from './context';
import type { BridgeEvent, Mutation } from '../model';
import { resultKey } from '../model';
import { DomainError } from '../domain-error';
import { makeBoard } from '../domain/board-factory';
import {
  currentKnockoutScore,
  knockoutAssignments,
  knockoutBasis,
  knockoutMatchId,
  knockoutLegs,
  knockoutSource,
  validateKnockout,
} from '../knockout';
export function applyKnockoutCommand(
  context: MutationContext,
  command: Extract<
    Mutation,
    { action: 'knockout-config' | 'knockout-publish' | 'knockout-decide' | 'knockout-reopen' | 'knockout-adjust' | 'knockout-overtime' | 'knockout-forfeit' }
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
    if (e.teamMethod !== 'bam') e.teamFormat = 'knockout';
    if (Object.values(e.penalties ?? {}).some(Boolean))
      throw new DomainError('請先清除原有 VP 判罰；淘汰賽請使用對局 IMP 調整');
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
      if (left === null && right === null) {
        ko.published[n.id] = { a: '', b: null };
        ko.decisions[n.id] = { winner: '', method: 'withdrawal', reason: '雙方均已退賽，無勝方' };
        count++;
        continue;
      }
      if (left === null || right === null) {
        const winner = left ?? right!;
        ko.published[n.id] = { a: winner, b: null };
        const bye = n.a.kind === 'bye' || n.b.kind === 'bye';
        ko.decisions[n.id] = { winner, method: bye ? 'bye' : 'withdrawal', reason: bye ? '種子輪空晉級' : '對手退賽，免賽晉級' };
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
        const matchId = knockoutMatchId(n.id, round);
        // After overtime, unpublished descendants may have moved. Allocate fresh boards,
        // sharing only with other matches in the same round, never a previously played round.
        const start = Object.keys(ko.extraLegs ?? {}).length
          ? (e.assignments.find((a) => a.round === round)?.boards[0] ?? Math.max(0, ...e.boards.map((b) => b.number)) + 1)
          : starts.get(round)!;
        const boards = Array.from({ length: n.boardsPerRound }, (_, i) => start + i);
        ensureBoards(e, boards);
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
      const decision = ko.decisions[id];
      if (decision?.method === 'withdrawal' && decision.loser && ko.withdrawn)
        delete ko.withdrawn[decision.loser];
      delete ko.published[id];
      delete ko.decisions[id];
      if (ko.extraLegs) delete ko.extraLegs[id];
      if (ko.adjustments) delete ko.adjustments[id];
    }
    if (ko.decisions[n.id].method === 'withdrawal' && ko.decisions[n.id].loser && ko.withdrawn)
      delete ko.withdrawn[ko.decisions[n.id].loser!];
    delete ko.decisions[n.id];
    e.status = 'live';
    context.detail = `撤回 ${n.name} 勝負及 ${descendants.size} 個後續安排`;
    return;
  }
  const p = ko.published[n.id];
  if (!p?.b) throw new DomainError('請先公布這場對局');
  if (ko.decisions[n.id]) throw new DomainError('這場已確認勝負');
  if (command.action === 'knockout-adjust') {
    if (e.teamMethod === 'bam') throw new DomainError('IMP 調整僅適用純 IMP 淘汰賽');
    ko.adjustments ??= {};
    ko.adjustments[n.id] = { a: command.a, b: command.b, reason: command.reason };
    context.detail = `${n.name} IMP 調整：${command.a} / ${command.b}（替換原調整）`;
    return;
  }
  if (command.action === 'knockout-forfeit') {
    if (![p.a, p.b].includes(command.loser)) throw new DomainError('棄權隊伍不在本對局');
    ko.decisions[n.id] = { winner: command.loser === p.a ? p.b : p.a, loser: command.loser,
      method: command.withdraw ? 'withdrawal' : 'forfeit', reason: command.reason, basis: knockoutBasis(e, n) };
    if (command.withdraw) {
      ko.withdrawn ??= {};
      ko.withdrawn[command.loser] = { reason: command.reason };
    }
    context.detail = `${n.name}：${command.loser} ${command.withdraw ? '退賽（不參加後續名次賽）' : '本場棄權'}；保留已打成績，不補造未打牌局`;
    return;
  }
  const assignments = knockoutAssignments(e, n);
  if (
    assignments.length !== knockoutLegs(e, n).length * 2 ||
    assignments.some((a) => a.boards.some((b) => !e.results[resultKey(a.id, b)]))
  )
    throw new DomainError('本對局尚未收齊所有圈次成績');
  if (e.club?.enabled && assignments.some((a) => !e.club!.finalized.includes(a.round)))
    throw new DomainError('請先結算並發布本對局的所有圈次');
  const score = currentKnockoutScore(e, n);
  if (command.action === 'knockout-overtime') {
    if (e.teamMethod === 'bam') throw new DomainError('此加賽流程僅適用純 IMP 淘汰賽');
    if (!score.tied) throw new DomainError('只有累積 IMP 平手時可追加加賽');
    const round = Math.max(e.currentRound ?? 0, ...e.assignments.map((a) => a.round)) + 1;
    if (round > 1024) throw new DomainError('圈次超過 1024 上限');
    const start = Math.max(0, ...e.boards.map((b) => b.number)) + 1;
    const boards = Array.from({ length: command.boards }, (_, i) => start + i);
    ko.extraLegs ??= {};
    (ko.extraLegs[n.id] ??= []).push({ round, boards });
    // Move only unresolved descendants, never alter existing assignments or scored IDs.
    const ends = new Map<string, number>();
    const counts = new Map<string, number>();
    const scheduled: typeof ko.nodes = [];
    for (const node of ko.nodes) {
      const prior = [node.a, node.b].flatMap((s) => s.kind === 'winner' || s.kind === 'loser' ? [s.id] : []);
      const earliest = Math.max(1, ...prior.map((id) => (ends.get(id) ?? 0) + 1));
      if (node.startRound < earliest) {
        if (ko.published[node.id]) throw new DomainError('後續對局已公布，請先撤回相關勝負');
        node.startRound = earliest;
      }
      if (!ko.published[node.id]) {
        let conflict;
        do {
          conflict = scheduled.find((old) => old.table === node.table && knockoutLegs(e, old).some((leg) =>
            leg.round >= node.startRound && leg.round < node.startRound + node.rounds));
          if (conflict) node.startRound = Math.max(...knockoutLegs(e, conflict).map((l) => l.round)) + 1;
        } while (conflict);
      }
      if (node.startRound + node.rounds - 1 > 1024) throw new DomainError('加賽後圈次超過 1024 上限');
      ends.set(node.id, Math.max(node.startRound + node.rounds - 1, ...(ko.extraLegs[node.id] ?? []).map((x) => x.round)));
      const count = Math.max(0, ...prior.map((id) => counts.get(id) ?? 0)) + node.rounds * node.boardsPerRound + (ko.extraLegs[node.id] ?? []).reduce((s, x) => s + x.boards.length, 0);
      if (count > 1024) throw new DomainError('加賽後任一隊伍的可能路徑超過 1024 牌');
      counts.set(node.id, count);
      scheduled.push(node);
    }
    ensureBoards(e, boards);
    const matchId = knockoutMatchId(n.id, round);
    e.assignments.push(
      { id: matchId + 'o', matchId, round, table: n.table, room: 'open', ns: p.a, ew: p.b, boards },
      { id: matchId + 'c', matchId, round, table: n.table, room: 'closed', ns: p.b, ew: p.a, boards },
    );
    e.rounds = Math.max(round, ...ends.values());
    e.status = 'live';
    context.detail = `${n.name} 追加第 ${round} 圈加賽 ${command.boards} 牌；後續對局延後，已公布對局不變`;
    return;
  }
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
    method: score.tied ? 'director' : 'score',
  };
  context.detail = `${n.name}：${winner} 晉級／勝方，${score.a}：${score.b}`;
}

function ensureBoards(e: BridgeEvent, numbers: number[]) {
  for (const number of numbers) if (!e.boards.some((b) => b.number === number)) {
    e.boards.push({ ...makeBoard(number), deal: { N: [], E: [], S: [], W: [] },
      ...(e.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}) });
  }
}
