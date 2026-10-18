import type { Assignment, BridgeEvent } from './model';

export function isInterleaved(assignments: Assignment[]) {
  const rounds = new Map<string, number>();
  for (const a of assignments) {
    if (rounds.has(a.matchId) && rounds.get(a.matchId) !== a.round) return true;
    rounds.set(a.matchId, a.round);
  }
  return false;
}

export function validateInterleavedLineups(assignments: Assignment[]) {
  if (!isInterleaved(assignments)) return;
  const directions = new Map<string, string>();
  const cycleLength = interleavedSize({ assignments }) - 1;
  for (const a of assignments)
    for (const seat of ['N', 'S', 'E', 'W'] as const) {
      const name = a.playerNames?.[seat]?.trim();
      if (!name) continue;
      const side = seat === 'N' || seat === 'S' ? 'ns' : 'ew';
      const cycle = Math.floor((a.round - 1) / cycleLength);
      const key = JSON.stringify([cycle, a[side], name]);
      if (directions.has(key) && directions.get(key) !== side)
        throw new Error(`${name} 在同一交錯循環中不可交換南北／東西搭檔，以免重打牌`);
      directions.set(key, side);
    }
}

// A bye is a scheduled absence, never a fabricated table or board result.
export function teamByes(
  event: Pick<
    BridgeEvent,
    'kind' | 'participants' | 'assignments' | 'byeVp' | 'swiss' | 'knockout'
  >,
) {
  if (event.knockout || event.kind !== 'teams' || event.participants.length % 2 === 0) return [];
  if (event.swiss)
    return event.swiss.publications
      .filter((p) => p.bye)
      .map((p) => ({ round: p.round, participantId: p.bye!, vp: event.byeVp ?? 12 }));
  return [...new Set(event.assignments.map((a) => a.round))]
    .sort((a, b) => a - b)
    .flatMap((round) => {
      const active = new Set(
        event.assignments.filter((a) => a.round === round).flatMap((a) => [a.ns, a.ew]),
      );
      return event.participants
        .filter((p) => !active.has(p.id))
        .map((p) => ({ round, participantId: p.id, vp: event.byeVp ?? 12 }));
    });
}

export type InterleavedGroups = string[][][];
export type InterleavedSize = 3 | 5;

export function defaultInterleavedGroups(
  event: Pick<BridgeEvent, 'participants' | 'rounds'>,
  size: InterleavedSize,
): InterleavedGroups {
  return Array.from({ length: event.rounds / (size - 1) }, () =>
    Array.from({ length: event.participants.length / size }, (_, g) =>
      event.participants.slice(g * size, (g + 1) * size).map((p) => p.id),
    ),
  );
}

export function validateInterleavedGroups(
  event: Pick<BridgeEvent, 'participants' | 'rounds'>,
  size: InterleavedSize,
  groups: InterleavedGroups,
) {
  const ids = new Set(event.participants.map((p) => p.id));
  if (
    ids.size % size ||
    event.rounds % (size - 1) ||
    groups.length !== event.rounds / (size - 1) ||
    groups.some(
      (cycle) =>
        cycle.length !== ids.size / size ||
        cycle.some((group) => group.length !== size) ||
        new Set(cycle.flat()).size !== ids.size ||
        cycle.flat().some((id) => !ids.has(id)),
    )
  )
    throw new Error('每個循環須完整分組，每隊恰好出現一次，且每組隊數符合所選模式');
}

// Infer the ring size from the connected teams in the first two rounds. This supports
// legacy CSV schedules without adding metadata or changing numeric round IDs.
export function interleavedSize(event: Pick<BridgeEvent, 'assignments'>): InterleavedSize {
  const rows = event.assignments.filter((a) => a.round <= 2);
  const connected = new Set<string>(rows.length ? [rows[0].ns] : []);
  for (let i = 0; i < 5; i++)
    for (const a of rows)
      if (connected.has(a.ns) || connected.has(a.ew)) {
        connected.add(a.ns);
        connected.add(a.ew);
      }
  return connected.size === 5 ? 5 : 3;
}

export function roundLabel(
  event: Pick<BridgeEvent, 'assignments' | 'teamMovement'>,
  round: number,
) {
  if (!event.teamMovement || round < 1) return String(round);
  const length = interleavedSize(event) - 1;
  return Math.floor((round - 1) / length) + 1 + '-' + (((round - 1) % length) + 1);
}

// Each group uses the same board sets (with copies); every cycle uses fresh
// boards, so regrouping cannot make a pair see an earlier cycle's deals.
export function interleavedAssignments(
  event: Pick<BridgeEvent, 'participants' | 'rounds' | 'boardsPerRound'>,
  size: InterleavedSize,
  groups = defaultInterleavedGroups(event, size),
  mode: 'rotation' | 'symmetric' = 'symmetric',
): Assignment[] {
  validateInterleavedGroups(event, size, groups);
  const shifts =
    size === 5 && mode === 'rotation'
      ? [1, 2, 3, 4]
      : Array.from({ length: (size - 1) / 2 }, (_, i) => [i + 1, size - i - 1]).flat();
  return groups.flatMap((cycle, c) =>
    shifts.flatMap((shift, r) =>
      cycle.flatMap((group, g) =>
        group.map((ns, i) => {
          const j = (i + shift) % size;
          const round = c * (size - 1) + r + 1;
          const table = g * size + i + 1;
          return {
            id: 'r' + round + 't' + table,
            round,
            table,
            room: i < j ? ('open' as const) : ('closed' as const),
            ns,
            ew: group[j],
            matchId:
              (c === 0 && g === 0 ? 'cycle' : 'cycle' + (c + 1) + 'g' + (g + 1)) +
              '-' +
              (Math.min(i, j) + 1) +
              '-' +
              (Math.max(i, j) + 1),
            boards: Array.from(
              { length: event.boardsPerRound },
              (_, b) => (c * size + ((i + j) % size)) * event.boardsPerRound + b + 1,
            ),
          };
        }),
      ),
    ),
  );
}

export function validateInterleaved(
  assignments: Assignment[],
  event: Pick<BridgeEvent, 'participants' | 'rounds' | 'boardsPerRound' | 'boards'>,
) {
  const n = event.participants.length;
  const size = interleavedSize({ assignments });
  if (
    n % size ||
    event.rounds % (size - 1) ||
    !event.rounds ||
    assignments.length !== n * event.rounds
  )
    throw new Error('交錯循環須完整匯入；隊數須為組別隊數的倍數，圈數須為每循環圈數的倍數');
  const occupied = new Set<string>(),
    played = new Set<string>(),
    tables = new Set<string>();
  const ids = new Set<string>(),
    opponents = new Set<string>();
  const matches = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (
      !Number.isInteger(a.round) ||
      a.round < 1 ||
      a.round > event.rounds ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(String(a.table)) ||
      (typeof a.table === 'number' && (!Number.isSafeInteger(a.table) || a.table < 1)) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(a.matchId) ||
      !['open', 'closed'].includes(a.room) ||
      a.ns === a.ew ||
      ![a.ns, a.ew].every((id) => event.participants.some((p) => p.id === id))
    )
      throw new Error('交錯循環圈次、桌號或隊伍錯誤');
    if (ids.has(a.id) || tables.has(`${a.round}:${a.table}`)) throw new Error('交錯循環桌次重複');
    ids.add(a.id);
    tables.add(`${a.round}:${a.table}`);
    if (
      a.boards.length !== event.boardsPerRound ||
      new Set(a.boards).size !== a.boards.length ||
      a.boards.some((b) => !event.boards.some((board) => board.number === b))
    )
      throw new Error('交錯循環牌組錯誤');
    for (const side of ['ns', 'ew'] as const) {
      const pair = `${a[side]}:${side}`;
      if (occupied.has(`${a.round}:${pair}`)) throw new Error('同一圈搭檔被安排至多桌');
      occupied.add(`${a.round}:${pair}`);
      for (const b of a.boards) {
        if (played.has(`${pair}:${b}`)) throw new Error('搭檔被安排重複打同一副牌');
        played.add(`${pair}:${b}`);
      }
    }
    matches.set(a.matchId, [...(matches.get(a.matchId) ?? []), a]);
  }
  for (const rows of matches.values()) {
    const open = rows.find((a) => a.room === 'open'),
      closed = rows.find((a) => a.room === 'closed');
    if (
      rows.length !== 2 ||
      !open ||
      !closed ||
      open.ns !== closed.ew ||
      open.ew !== closed.ns ||
      open.round === closed.round ||
      Math.ceil(open.round / (size - 1)) !== Math.ceil(closed.round / (size - 1)) ||
      [...open.boards].sort((a, b) => a - b).join() !==
        [...closed.boards].sort((a, b) => a - b).join()
    )
      throw new Error('交錯循環每場須有同一循環內不同圈、方向相反且牌組相同的兩桌');
    const cycle = Math.floor((open.round - 1) / (size - 1));
    const key = cycle + ':' + [open.ns, open.ew].sort().join(':');
    if (opponents.has(key)) throw new Error('交錯循環對手重複');
    opponents.add(key);
  }
  const boardCycles = new Map<number, number>();
  for (let c = 0; c < event.rounds / (size - 1); c++) {
    const rows = assignments.filter((a) => Math.floor((a.round - 1) / (size - 1)) === c);
    const unseen = new Set(event.participants.map((p) => p.id));
    while (unseen.size) {
      const connected = new Set([unseen.values().next().value!]);
      for (let i = 0; i < n; i++)
        for (const a of rows)
          if (connected.has(a.ns) || connected.has(a.ew)) {
            connected.add(a.ns);
            connected.add(a.ew);
          }
      if (connected.size !== size) throw new Error('同一循環內須維持完整的三隊或五隊分組');
      for (const id of connected) unseen.delete(id);
    }
    for (const a of rows)
      for (const b of a.boards) {
        if (boardCycles.has(b) && boardCycles.get(b) !== c) throw new Error('不同循環須使用新牌組');
        boardCycles.set(b, c);
      }
  }
}
