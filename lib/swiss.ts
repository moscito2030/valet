import blossom from 'edmonds-blossom';
import type { Assignment, BridgeEvent, SwissPublication } from './model';
import { project } from './scoring';
import { isInterleaved } from './team-movement';
import { DomainError } from './domain-error';

type Source = Pick<
  BridgeEvent,
  | 'id'
  | 'revision'
  | 'kind'
  | 'status'
  | 'rounds'
  | 'boardsPerRound'
  | 'participants'
  | 'assignments'
  | 'results'
  | 'boards'
  | 'byeVp'
  | 'swiss'
  | 'teamMovement'
>;
export function assertSwissTeams(event: Source) {
  if (event.kind !== 'teams' || event.teamMovement || isInterleaved(event.assignments))
    throw new DomainError('Swiss 僅適用非交錯循環的隊制賽');
}
export function swissRoundComplete(
  event: Pick<BridgeEvent, 'participants' | 'assignments' | 'swiss'>,
  round: number,
) {
  const rows = event.assignments.filter((a) => a.round === round && a.room === 'open');
  const bye = event.swiss?.publications.find((p) => p.round === round && p.bye)?.bye;
  const ids = rows.flatMap((a) => [a.ns, a.ew]).concat(bye ? [bye] : []);
  return (
    ids.length === event.participants.length && new Set(ids).size === event.participants.length
  );
}
const edgeKey = (a: string, b: string) => [a, b].sort().join('\0');

// Maximum-cardinality Blossom first establishes feasibility. Integer weights then
// minimize total VP distance; stable input ordering makes previews reproducible.
export function matchSwiss(ids: string[], scores: Map<string, number>, forbidden: Set<string>) {
  if (!ids.length) return { pairs: [] as [string, string][], cost: 0 };
  if (ids.length % 2) return null;
  const costs: [number, number, number][] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      if (!forbidden.has(edgeKey(ids[i], ids[j])))
        costs.push([i, j, Math.round(Math.abs(scores.get(ids[i])! - scores.get(ids[j])!) * 100)]);
    }
  if (!costs.length) return null;
  const max = Math.max(...costs.map((e) => e[2])) + 1;
  const mate = blossom(
    costs.map(([i, j, c]) => [i, j, max - c]),
    true,
  );
  if (ids.some((_, i) => mate[i] === undefined || mate[i] < 0 || mate[mate[i]] !== i)) return null;
  const pairs: [string, string][] = [];
  let cost = 0;
  for (let i = 0; i < ids.length; i++)
    if (mate[i] > i) {
      pairs.push([ids[i], ids[mate[i]]]);
      cost += Math.round(Math.abs(scores.get(ids[i])! - scores.get(ids[mate[i]])!) * 100);
    }
  return { pairs, cost };
}

export function swissPreview(event: Source, round: number, partial: boolean) {
  assertSwissTeams(event);
  if (!event.swiss || event.status !== 'live') throw new DomainError('請先設定 Swiss 並開放賽事');
  if (!Number.isInteger(round) || round < 1 || round > event.rounds)
    throw new DomainError('圈數超過賽程範圍');
  if (round > 1 && !swissRoundComplete(event, round - 1))
    throw new DomainError('請先完整公布前一圈對戰');
  if (event.assignments.some((a) => a.round > round))
    throw new DomainError('後續圈次已公布，不可重排較早圈次');
  const sourceRound = Math.max(0, round - (event.swiss.mode === 'delayed' ? 2 : 1));
  const projection = project(event);
  const relevant = projection.matches.filter((m) => m.round <= sourceRound);
  const byes = (projection.byes ?? []).filter((b) => b.round <= sourceRound);
  const scores = event.participants.map((p) => {
    let score = 0,
      ready = true,
      unresolved = 0;
    for (let r = 1; r <= sourceRound; r++) {
      const match = relevant.find((m) => m.round === r && (m.a === p.id || m.b === p.id));
      const bye = byes.find((b) => b.round === r && b.participantId === p.id);
      if (match && match.completed === match.total)
        score += (match.a === p.id ? match.vpA : match.vpB) ?? 0;
      else if (bye?.awarded) score += bye.vp;
      else {
        ready = false;
        unresolved++;
      }
    }
    return { id: p.id, score, ready, low: score, high: score + 20 * unresolved };
  });
  const basis = relevant
    .filter((m) => m.completed === m.total)
    .map((m) => ({ id: m.id, vpA: m.vpA, vpB: m.vpB }));
  const byeBasis = byes
    .filter((b) => b.awarded)
    .map(({ round, participantId, vp }) => ({ round, participantId, vp }));
  const settled = scores.every((s) => s.ready);
  if (!partial && !settled)
    throw new DomainError(`第 ${sourceRound} 圈及之前尚未收齊，請等待或使用保守分批公布`);
  const fixed = event.assignments.filter((a) => a.round === round);
  const fixedBye = event.swiss.publications.find((p) => p.round === round && p.bye)?.bye;
  const occupied = new Set(fixed.flatMap((a) => [a.ns, a.ew]).concat(fixedBye ? [fixedBye] : []));
  // Later-round tie order is stable, derived from the event UUID and participant ID.
  const seed = (id: string) => {
    let h = 2166136261;
    for (const c of event.id + id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  };
  const remaining = scores
    .filter((s) => !occupied.has(s.id))
    .sort((a, b) => b.score - a.score || seed(a.id) - seed(b.id) || a.id.localeCompare(b.id));
  const ids = remaining.map((s) => s.id),
    scoreMap = new Map(scores.map((s) => [s.id, s.score]));
  const forbidden = new Set(
    event.assignments.filter((a) => a.round < round).map((a) => edgeKey(a.ns, a.ew)),
  );
  let candidate: { pairs: [string, string][]; cost: number; bye?: string } | null = null;
  if (round === 1 && occupied.size === 0) {
    const ordered = event.participants.map((p) => p.id);
    const pairs: [string, string][] = [];
    for (let i = 0; i + 1 < ordered.length; i += 2) pairs.push([ordered[i], ordered[i + 1]]);
    candidate = {
      pairs,
      cost: 0,
      ...(ordered.length % 2 ? { bye: ordered[ordered.length - 1] } : {}),
    };
  } else if (ids.length % 2) {
    const byeCount = (id: string) =>
      event.swiss!.publications.filter((p) => p.round < round && p.bye === id).length;
    const eligible = [...remaining].sort(
      (a, b) => byeCount(a.id) - byeCount(b.id) || a.score - b.score || seed(a.id) - seed(b.id),
    );
    for (const item of eligible) {
      const matched = matchSwiss(
        ids.filter((id) => id !== item.id),
        scoreMap,
        forbidden,
      );
      if (matched) {
        candidate = { ...matched, bye: item.id };
        break;
      }
    }
  } else candidate = matchSwiss(ids, scoreMap, forbidden);
  if (!candidate) throw new DomainError('無法在不重複對手的條件下完成剩餘配對；不會自動放寬規則');
  const unknown = scores.filter((s) => !s.ready);
  const safe = (a: string, b: string) => {
    const x = scores.find((s) => s.id === a)!,
      y = scores.find((s) => s.id === b)!;
    return (
      x.ready &&
      y.ready &&
      (unknown.every((u) => Math.min(x.score, y.score) > u.high) ||
        unknown.every((u) => Math.max(x.score, y.score) < u.low))
    );
  };
  const pairs = settled ? candidate.pairs : candidate.pairs.filter(([a, b]) => safe(a, b));
  const bye = settled ? candidate.bye : undefined;
  // The candidate is a complete legal matching, so every published subset leaves
  // a feasible remainder. It does not promise the same optimum as waiting for all results.
  return {
    round,
    sourceRound,
    pairs,
    bye,
    basis,
    byeBasis,
    scores,
    settled,
    remaining: ids.length - pairs.length * 2 - (bye ? 1 : 0),
    repeatedBye: !!bye && event.swiss.publications.some((p) => p.bye === bye),
  };
}

export function swissBasisChanged(event: Source, publication: SwissPublication) {
  const p = project(event);
  return (
    publication.basis.some((old) => {
      const now = p.matches.find((m) => m.id === old.id);
      return !now || now.completed !== now.total || now.vpA !== old.vpA || now.vpB !== old.vpB;
    }) ||
    publication.byeBasis.some(
      (old) =>
        !p.byes?.some(
          (b) =>
            b.round === old.round &&
            b.participantId === old.participantId &&
            b.awarded &&
            b.vp === old.vp,
        ),
    )
  );
}

export function publishSwiss(event: BridgeEvent, round: number, partial: boolean, at: string) {
  const preview = swissPreview(event, round, partial);
  if (!preview.pairs.length && !preview.bye)
    throw new DomainError('目前沒有可公布的新對戰，請等待更多成績');
  const existing = event.assignments.filter((a) => a.round === round);
  let table = Math.max(0, ...existing.map((a) => Number(a.table)));
  const boards = Array.from(
    { length: event.boardsPerRound },
    (_, i) => (round - 1) * event.boardsPerRound + i + 1,
  );
  if (boards.some((n) => !event.boards.some((b) => b.number === n)))
    throw new DomainError('本圈牌組尚未建立');
  for (const [ns, ew] of preview.pairs) {
    table++;
    const matchId = `swiss-r${round}t${table}`;
    const base = { round, table, matchId, boards };
    const rows: Assignment[] = [
      { ...base, id: matchId + 'o', room: 'open', ns, ew },
      { ...base, id: matchId + 'c', room: 'closed', ns: ew, ew: ns },
    ];
    event.assignments.push(...rows);
  }
  event.swiss!.publications.push({
    round,
    sourceRound: preview.sourceRound,
    sourceRevision: event.revision,
    at,
    pairs: preview.pairs,
    ...(preview.bye ? { bye: preview.bye } : {}),
    basis: preview.basis,
    byeBasis: preview.byeBasis,
    scores: preview.scores.map(({ id, score, ready }) => ({ id, score, ready })),
  });
  return `第 ${round} 圈公布 ${preview.pairs.length} 場${preview.bye ? '；輪空 ' + preview.bye : ''}；依據第 ${preview.sourceRound} 圈及之前成績，剩餘 ${preview.remaining} 隊待配對`;
}
