import type { BridgeEvent, Projection } from './model';
import { resultKey } from './model';
import type { Knockout, KnockoutNode, KnockoutSource } from './knockout-schema';
import { DomainError } from './domain-error';
import { project } from './scoring';
export const knockoutMatchId = (id: string, round: number) => `ko-${id}-r${round}`;
export function knockoutAssignments(event: Pick<BridgeEvent, 'assignments'>, node: KnockoutNode) {
  const ids = new Set(
    Array.from({ length: node.rounds }, (_, i) => knockoutMatchId(node.id, node.startRound + i)),
  );
  return event.assignments.filter((a) => ids.has(a.matchId));
}
export function knockoutSource(source: KnockoutSource, ko: Knockout): string | null | undefined {
  if (source.kind === 'bye') return null;
  if (source.kind === 'team') return source.id;
  const d = ko.decisions[source.id];
  return d ? (source.kind === 'winner' ? d.winner : (d.loser ?? null)) : undefined;
}
export function validateKnockout(
  nodes: KnockoutNode[],
  event: Pick<BridgeEvent, 'kind' | 'participants'>,
) {
  if (event.kind !== 'teams') throw new DomainError('淘汰賽僅適用隊制賽');
  const teams = new Set(event.participants.map((p) => p.id)),
    seen = new Map<string, KnockoutNode>(),
    used = new Set<string>(),
    places = new Set<number>(),
    path = new Map<string, number>(),
    possible = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (seen.has(node.id)) throw new DomainError('對局識別碼不可重複');
    if (node.startRound + node.rounds - 1 > 1024) throw new DomainError('淘汰賽圈次超過上限');
    let prior = 0;
    const all = new Set<string>();
    for (const source of [node.a, node.b]) {
      if (source.kind === 'bye') continue;
      const key = source.kind + ':' + source.id;
      if (used.has(key)) throw new DomainError('同一隊伍或勝／敗方出口不能重複使用');
      used.add(key);
      if (source.kind === 'team') {
        if (!teams.has(source.id)) throw new DomainError('對戰表包含未知隊伍');
        all.add(source.id);
      } else {
        const previous = seen.get(source.id);
        if (!previous) throw new DomainError('勝／敗方來源必須是前面已設定的對局，不能循環引用');
        if (previous.startRound + previous.rounds > node.startRound)
          throw new DomainError('後續對局必須在來源對局全部圈次結束後開始');
        if (source.kind === 'loser' && (previous.a.kind === 'bye' || previous.b.kind === 'bye'))
          throw new DomainError('輪空晉級沒有敗方，不能接至順位賽');
        if (
          (source.kind === 'winner' && previous.winnerPlace) ||
          (source.kind === 'loser' && previous.loserPlace)
        )
          throw new DomainError('已指定最終名次的出口不能再安排後續對局');
        prior = Math.max(prior, path.get(source.id) ?? 0);
        for (const id of possible.get(source.id) ?? []) all.add(id);
      }
    }
    if (node.a.kind === 'bye' && node.b.kind === 'bye') throw new DomainError('對局不能兩邊都輪空');
    const count = prior + node.rounds * node.boardsPerRound;
    if (count > 1024) throw new DomainError('任一隊伍的可能路徑超過 1024 牌（輪空也計入）');
    for (const place of [node.winnerPlace, node.loserPlace])
      if (place !== undefined) {
        if (place > teams.size || places.has(place))
          throw new DomainError('最終名次不可超出隊數或重複');
        places.add(place);
      }
    if (node.loserPlace && (node.a.kind === 'bye' || node.b.kind === 'bye'))
      throw new DomainError('輪空對局不能指定敗方名次');
    // Independent branches can run concurrently; branches sharing any possible entrant cannot.
    for (const old of seen.values())
      if (
        node.startRound < old.startRound + old.rounds &&
        old.startRound < node.startRound + node.rounds
      ) {
        if (node.table === old.table) throw new DomainError('同圈同桌不能安排兩個對局');
        // Winner/loser branches from the same source are mutually exclusive; concrete teams are checked at publication.
        const direct = [node.a, node.b].filter((s) => s.kind === 'team').map((s) => s.id);
        if (direct.some((id) => (possible.get(old.id) ?? new Set()).has(id)))
          throw new DomainError('同一隊伍不能同圈出賽兩次');
      }
    seen.set(node.id, node);
    path.set(node.id, count);
    possible.set(node.id, all);
  }
  if ([...teams].some((id) => !used.has('team:' + id)))
    throw new DomainError('每支隊伍都必須安排在對戰表中');
  return Math.max(0, ...path.values());
}
export function knockoutBasis(
  event: Pick<BridgeEvent, 'assignments' | 'results'>,
  node: KnockoutNode,
) {
  return JSON.stringify(
    knockoutAssignments(event, node).map((a) => [
      a.id,
      a.ns,
      a.ew,
      a.boards.map((b) => [b, event.results[resultKey(a.id, b)] ?? null]),
    ]),
  );
}
export function assertKnockoutDecisions(event: BridgeEvent) {
  if (!event.knockout) return;
  for (const node of event.knockout.nodes) {
    const d = event.knockout.decisions[node.id];
    if (d?.basis !== undefined && d.basis !== knockoutBasis(event, node))
      throw new DomainError('這場對局已確認勝負；請先撤回勝負與尚未開打的後續對局，再更正成績');
  }
}
export function knockoutScore(
  event: Pick<BridgeEvent, 'teamMethod' | 'knockout'>,
  node: KnockoutNode,
  projection: Projection,
) {
  const matches = Array.from({ length: node.rounds }, (_, i) =>
    projection.matches.find((m) => m.id === knockoutMatchId(node.id, node.startRound + i)),
  );
  const complete = matches.every((m) => m && m.completed === m.total);
  const a = matches.reduce(
    (s, m) => s + (event.teamMethod === 'bam' ? (m?.bamA ?? 0) : (m?.marginA ?? 0)),
    0,
  );
  const b = matches.reduce(
    (s, m) => s + (event.teamMethod === 'bam' ? (m?.bamB ?? 0) : (m?.marginB ?? 0)),
    0,
  );
  return { a, b, complete, tied: Math.abs(a - b) < 1e-8 };
}
export function knockoutRoundReady(event: Pick<BridgeEvent, 'knockout'>, round: number) {
  return (
    !event.knockout ||
    event.knockout.nodes
      .filter((n) => n.startRound <= round && round < n.startRound + n.rounds)
      .every((n) => !!event.knockout!.published[n.id])
  );
}
export function seedKnockout(
  ids: string[],
  rounds = 1,
  boardsPerRound = 8,
  bronze = false,
): KnockoutNode[] {
  let size = 2;
  while (size < ids.length) size *= 2;
  let seeds = [1, 2];
  while (seeds.length < size) {
    const n = seeds.length * 2;
    seeds = seeds.flatMap((s) => [s, n + 1 - s]);
  }
  const nodes: KnockoutNode[] = [];
  let sources: KnockoutSource[] = seeds.map((s) =>
      ids[s - 1] ? { kind: 'team', id: ids[s - 1] } : { kind: 'bye' },
    ),
    stage = 0;
  while (sources.length > 1) {
    const next: KnockoutSource[] = [];
    const count = sources.length / 2;
    for (let i = 0; i < count; i++) {
      const id = `s${stage + 1}m${i + 1}`;
      nodes.push({
        id,
        name: count === 1 ? '冠軍賽' : `${count * 2} 強賽 ${i + 1}`,
        a: sources[i * 2],
        b: sources[i * 2 + 1],
        startRound: stage * rounds + 1,
        rounds,
        boardsPerRound,
        table: i + 1,
        ...(count === 1 ? { winnerPlace: 1, loserPlace: 2 } : {}),
      });
      next.push({ kind: 'winner', id });
    }
    sources = next;
    stage++;
  }
  if (bronze && ids.length >= 4) {
    const semifinal = nodes.filter((n) => n.startRound === (stage - 2) * rounds + 1);
    if (semifinal.length === 2)
      nodes.push({
        id: 'bronze',
        name: '銅牌戰',
        a: { kind: 'loser', id: semifinal[0].id },
        b: { kind: 'loser', id: semifinal[1].id },
        startRound: (stage - 1) * rounds + 1,
        rounds,
        boardsPerRound,
        table: 2,
        winnerPlace: 3,
        loserPlace: 4,
      });
  }
  return nodes;
}
export function currentKnockoutScore(event: BridgeEvent, node: KnockoutNode) {
  return knockoutScore(event, node, project(event));
}

/** Unused outcomes can feed any subsequent placement match, at any depth. */
export function availableKnockoutOutputs(nodes: KnockoutNode[]): KnockoutSource[] {
  const used = new Set(
    nodes
      .flatMap((n) => [n.a, n.b])
      .filter((s) => s.kind === 'winner' || s.kind === 'loser')
      .map((s) => s.kind + ':' + s.id),
  );
  return (['loser', 'winner'] as const).flatMap((kind) =>
    nodes
      .filter(
        (n) =>
          !used.has(kind + ':' + n.id) &&
          !(kind === 'loser'
            ? n.loserPlace || n.a.kind === 'bye' || n.b.kind === 'bye'
            : n.winnerPlace),
      )
      .map((n) => ({ kind, id: n.id })),
  );
}
export function newKnockoutPlacement(
  nodes: KnockoutNode[],
  rounds: number,
  boardsPerRound: number,
): KnockoutNode {
  const sources = availableKnockoutOutputs(nodes);
  if (sources.length < 2) throw new DomainError('至少需要兩個未接續、未指定最終名次的勝方或敗方');
  const [a, b] = sources;
  const startRound = Math.max(
    ...[a, b].map((s) => {
      const n = nodes.find((n) => s.kind !== 'bye' && n.id === s.id)!;
      return n.startRound + n.rounds;
    }),
  );
  let id = 'placement' + (nodes.length + 1);
  while (nodes.some((n) => n.id === id)) id += 'x';
  let table = 1;
  while (
    nodes.some(
      (n) =>
        n.table === table &&
        n.startRound < startRound + rounds &&
        startRound < n.startRound + n.rounds,
    )
  )
    table++;
  if (table > 32) throw new DomainError('此時段沒有可用桌號，請先調整對局時段');
  return { id, name: '排名賽', a, b, startRound, rounds, boardsPerRound, table };
}
