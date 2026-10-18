import { DomainError } from '../domain-error';
import { parseResultsCsv } from '../imports';
import { Mutation, Result, ResultInput, resultKey } from '../model';
import type { MutationContext } from './context';
import { scoredInput } from './scored-input';

export function applyScoresCommand(
  context: MutationContext,
  command: Extract<
    Mutation,
    {
      action:
        'clear-results' | 'results' | 'results-import' | 'penalty' | 'split-contract' | 'ruling';
    }
  >,
) {
  const { event: e, at, changes } = context;
  let detail: string | undefined;
  if (command.action === 'clear-results') {
    if (command.confirmName !== (e.stageName || e.name)) throw new DomainError('確認名稱不符');
    for (const [key, before] of Object.entries(e.results))
      changes.push({ key, before, after: null });
    detail = `清除 ${changes.length} 筆成績；原扣分 ${JSON.stringify(e.penalties ?? {})}；原進度 ${e.currentRound ?? 0}／${e.roundPhase ?? 'playing'}／${e.status}；原結算圈次 ${JSON.stringify(e.club?.finalized ?? [])}`;
    e.results = {};
    e.penalties = {};
    e.status = 'live';
    e.currentRound = 0;
    e.roundPhase = 'break';
    if (e.club) {
      e.club.confirmations = {};
      e.club.finalized = [];
    }
  } else if (command.action === 'results' || command.action === 'results-import') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事，再更正成績。');
    const seen = new Set<string>();
    let rows: (ResultInput & { status?: 'cancelled' })[];
    try {
      rows = command.action === 'results-import' ? parseResultsCsv(command.csv) : command.results;
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
    for (const r of rows) {
      const a = e.assignments.find((a) => a.id === r.assignmentId),
        b = e.boards.find((b) => b.number === r.board);
      if (!a || !b || !a.boards.includes(r.board)) throw new DomainError('桌次與牌號不符合賽程。');
      const key = resultKey(a.id, b.number);
      if (e.results[key]?.split)
        throw new DomainError('請先由裁判撤銷不平衡合約，再更正原始成績', 403);
      if (e.results[key]?.status === 'cancelled' && command.action !== 'results-import')
        throw new DomainError('Cancelled 成績只能由裁判恢復。', 403);
      if (seen.has(key)) throw new DomainError('同一批資料包含重複成績。');
      seen.add(key);
      const after: Result =
        r.status === 'cancelled'
          ? { ...r, status: 'cancelled', nsScore: 0, updatedAt: at }
          : { ...scoredInput(r, e, b), updatedAt: at };
      changes.push({ key, before: e.results[key] ?? null, after });
      e.results[key] = after;
    }
  } else if (command.action === 'penalty') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    if (!e.participants.some((p) => p.id === command.participantId))
      throw new DomainError('找不到參賽者');
    e.penalties ??= {};
    detail = `${command.participantId} 扣分： ${e.penalties[command.participantId] ?? 0} → ${command.amount}`;
    e.penalties[command.participantId] = command.amount;
  } else if (command.action === 'split-contract') {
    if (e.kind !== 'teams') throw new DomainError('不平衡合約僅限隊制賽');
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    const a = e.assignments.find((a) => a.id === command.assignmentId);
    const b = e.boards.find((b) => b.number === command.board);
    if (!a || !b || !a.boards.includes(b.number)) throw new DomainError('桌次與牌號不符合賽程');
    const key = resultKey(a.id, b.number);
    const before = e.results[key];
    if (!before || before.status === 'cancelled' || before.status === 'average')
      throw new DomainError('請先登記或恢復本桌實際合約');
    const after: Result = { ...before, updatedAt: at };
    if (command.contracts) {
      for (const r of Object.values(command.contracts)) {
        if (r.assignmentId !== a.id || r.board !== b.number)
          throw new DomainError('判罰合約的桌次與牌號不符');
      }
      after.split = {
        ns: scoredInput(command.contracts.ns, e, b),
        ew: scoredInput(command.contracts.ew, e, b),
      };
    } else delete after.split;
    e.results[key] = after;
    changes.push({ key, before, after });
    detail = `${key}: ${command.contracts ? 'NS／EW 分別指定合約' : '撤銷不平衡合約，恢復原始紀錄'}`;
  } else if (command.action === 'ruling') {
    if (e.status === 'finished') throw new DomainError('請先重新開放賽事');
    const a = e.assignments.find((a) => a.id === command.assignmentId);
    const b = e.boards.find((b) => b.number === command.board);
    if (!a || !b || !a.boards.includes(b.number)) throw new DomainError('桌次與牌號不符合賽程');
    const key = resultKey(a.id, b.number);
    if (e.results[key]?.split) throw new DomainError('請先撤銷不平衡合約，再取消此副');
    if (!command.cancelled && !command.result) {
      const before = e.results[key];
      if (before?.status !== 'cancelled') throw new DomainError('此副尚未取消');
      const cancellation = [...e.audit].reverse().flatMap(a => [...(a.changes ?? [])].reverse()).find(c => c.key === key && c.after?.status === 'cancelled' && c.before?.status !== 'cancelled');
      const original = cancellation?.before;
      const after = original && original.status !== 'average' ? { ...original, updatedAt: at } : null;
      changes.push({ key, before, after });
      if (after) e.results[key] = after;
      else delete e.results[key];
      context.detail = `${key}: ${after ? '恢復取消前成績' : '恢復為未收分'}`;
      return;
    }
    const r = command.cancelled
      ? (e.results[key] ?? {
          assignmentId: a.id,
          board: b.number,
          level: 0,
          strain: 'NT' as const,
          doubled: 1 as const,
          declarer: 'N' as const,
          tricks: 0,
          lead: '',
        })
      : command.result;
    if (!r || r.assignmentId !== a.id || r.board !== b.number)
      throw new DomainError('恢復成績需提供此桌完整合約');
    const after: Result = {
      ...(command.cancelled ? r : scoredInput(r, e, b)),
      status: command.cancelled ? 'cancelled' : 'played',
      nsScore: command.cancelled ? 0 : scoredInput(r, e, b).nsScore,
      updatedAt: at,
    };
    changes.push({ key, before: e.results[key] ?? null, after });
    e.results[key] = after;
    detail = `${key}: ${command.cancelled ? 'Cancelled' : '恢復合約'}`;
  }
  context.detail = detail;
}
