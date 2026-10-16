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
  for (const a of assignments)
    for (const seat of ['N', 'S', 'E', 'W'] as const) {
      const name = a.playerNames?.[seat]?.trim();
      if (!name) continue;
      const side = seat === 'N' || seat === 'S' ? 'ns' : 'ew';
      const key = JSON.stringify([a[side], name]);
      if (directions.has(key) && directions.get(key) !== side)
        throw new Error(`${name} 在交錯循環中不可交換南北／東西搭檔，以免重打牌`);
      directions.set(key, side);
    }
}

// A bye is a scheduled absence, never a fabricated table or board result.
export function teamByes(
  event: Pick<BridgeEvent, 'kind' | 'participants' | 'assignments' | 'byeVp'>,
) {
  if (event.kind !== 'teams' || event.participants.length % 2 === 0) return [];
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

// Each edge {i,j} uses group (i+j) mod n. At an odd-sized table ring this
// gives distinct groups at every table and no repeated group for either pair.
// Consecutive shifts +d, -d supply both halves of each comparison.
export function interleavedAssignments(
  event: Pick<BridgeEvent, 'participants' | 'boardsPerRound'>,
): Assignment[] {
  const n = event.participants.length;
  if (n !== 3 && n !== 5) throw new Error('交錯循環僅支援三隊或五隊');
  const shifts = Array.from({ length: (n - 1) / 2 }, (_, i) => [i + 1, n - i - 1]).flat();
  return shifts.flatMap((shift, r) =>
    event.participants.map((p, i) => {
      const j = (i + shift) % n;
      return {
        id: `r${r + 1}t${i + 1}`,
        round: r + 1,
        table: i + 1,
        room: i < j ? ('open' as const) : ('closed' as const),
        ns: p.id,
        ew: event.participants[j].id,
        matchId: `cycle-${Math.min(i, j) + 1}-${Math.max(i, j) + 1}`,
        boards: Array.from(
          { length: event.boardsPerRound },
          (_, b) => ((i + j) % n) * event.boardsPerRound + b + 1,
        ),
      };
    }),
  );
}

export function validateInterleaved(
  assignments: Assignment[],
  event: Pick<BridgeEvent, 'participants' | 'rounds' | 'boardsPerRound' | 'boards'>,
) {
  const n = event.participants.length;
  if (![3, 5].includes(n) || event.rounds !== n - 1 || assignments.length !== n * (n - 1))
    throw new Error('交錯循環須完整匯入三隊兩圈或五隊四圈');
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
      Math.ceil(open.round / 2) !== Math.ceil(closed.round / 2) ||
      [...open.boards].sort((a, b) => a - b).join() !==
        [...closed.boards].sort((a, b) => a - b).join()
    )
      throw new Error('交錯循環每場須有相鄰兩圈、方向相反且牌組相同的兩桌');
    const key = [open.ns, open.ew].sort().join(':');
    if (opponents.has(key)) throw new Error('交錯循環對手重複');
    opponents.add(key);
  }
}
