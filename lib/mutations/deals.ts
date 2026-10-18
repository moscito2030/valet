import { boardGroups } from '../board-groups';
import { DomainError } from '../domain-error';
import { parsePbn } from '../imports';
import { Board, Mutation } from '../model';
import type { MutationContext } from './context';

export function applyDealsCommand(
  context: MutationContext,
  command: Extract<Mutation, { action: 'board-publication' | 'pbn' }>,
) {
  const { event: e, at, changes } = context;
  let detail: string | undefined;
  if (command.action === 'board-publication') {
    // Materialize legacy publication settings before changing just one board.
    e.boards = e.boards.map((b) => ({ ...b, published: b.published ?? e.publishBoards }));
    const b = e.boards.find((b) => b.number === command.board);
    if (!b) throw new DomainError('找不到牌號');
    const targets = boardGroups(e.boards, e.boardsPerRound).find((group) =>
      group.some((board) => board.number === b.number),
    )!;
    detail = `${targets.map((board) => `B${board.number}`).join('、')}: ${b.published ? '公開' : '隱藏'} → ${command.published ? '公開' : '隱藏'}`;
    for (const target of targets) target.published = command.published;
  } else if (command.action === 'pbn') {
    if (Object.keys(e.results).length)
      throw new DomainError('已有成績時不可更換牌型與身價。請在收分前匯入。');
    let boards: Board[];
    try {
      boards = parsePbn(command.pbn);
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
    if (
      boards.length !== e.boards.length ||
      boards.some((b) => !e.boards.some((x) => x.number === b.number))
    )
      throw new DomainError('PBN 需包含賽事所有牌號，且不得包含額外牌號。');
    const ordered = [...boards].sort((a, b) => a.number - b.number);
    const explicitGroups = new Set(boards.map((b) => b.group).filter(Boolean));
    let prefix = 'Auto';
    while ([...explicitGroups].some((group) => group!.startsWith(`${prefix}-`))) prefix += '_';
    e.boards = boards.map((b) => ({
      ...b,
      ...(e.gameMode === 'minibridge' ? { vulnerability: 'None' as const } : {}),
      group:
        b.group ??
        `${prefix}-${Math.floor(ordered.findIndex((item) => item.number === b.number) / e.boardsPerRound) + 1}`,
      published: e.boards.find((old) => old.number === b.number)?.published ?? e.publishBoards,
    }));
    for (const b of e.boards) {
      if (e.boards.some((other) => other.group === b.group && !other.published))
        b.published = false;
    }
  }
  context.detail = detail;
}
