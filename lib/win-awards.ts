import type { BridgeEvent, Projection } from './model';
import { resultKey } from './model';
export type WinAwardEntry = {
  round: number;
  key: string;
  outcome: 'win' | 'loss' | 'draw' | 'pending' | 'excluded';
  score: number | null;
};
export type WinAwardRow = {
  id: string;
  name: string;
  group?: 'NS' | 'EW';
  win: number;
  loss: number;
  draw: number;
  pending: number;
  excluded: number;
  units: number;
  entries: WinAwardEntry[];
};
type Input = Pick<
  BridgeEvent,
  'kind' | 'participants' | 'assignments' | 'results' | 'teamMethod'
  | 'pairMethod' | 'winAward' | 'knockout'
> & { projection: Projection };
// Consume the caller's projection and visible results; never recompute with private results.
export function winAwardStats(event: Input): WinAwardRow[] {
  const rows: WinAwardRow[] = event.participants.map((p) => ({
    id: p.id,
    name: p.name,
    group: p.group,
    win: 0,
    loss: 0,
    draw: 0,
    pending: 0,
    excluded: 0,
    units: 0,
    entries: [],
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  function add(id: string, entry: WinAwardEntry) {
    const row = byId.get(id);
    if (!row) return;
    row.entries.push(entry);
    row[entry.outcome]++;
  }
  const outcome = (margin: number): WinAwardEntry['outcome'] =>
    Math.abs(margin) < 1e-8 ? 'draw' : margin > 0 ? 'win' : 'loss';
  if (event.knockout) {
    for (const n of event.knockout.nodes) {
      const p = event.knockout.published[n.id], d = event.knockout.decisions[n.id];
      if (!p?.b) continue;
      for (const id of [p.a, p.b]) add(id, { key: n.id, round: n.startRound, outcome: !d ? 'pending' : d.winner === id ? 'win' : 'loss', score: null });
    }
  } else if (event.kind === 'teams') {
    for (const match of event.projection.matches) {
      const completed = match.completed === match.total && match.total > 0;
      for (const [id, margin, vp] of [
        [match.a, match.marginA, match.vpA],
        [match.b, match.marginB, match.vpB],
      ] as const) {
        const effectiveMargin = event.teamMethod === 'bam' ? (id === match.a ? (match.bamA ?? 0) - (match.bamB ?? 0) : (match.bamB ?? 0) - (match.bamA ?? 0)) : margin;
        const state = !completed ? 'pending' : vp === null ? 'excluded' : outcome(effectiveMargin);
        add(id, {
          key: match.id,
          round: match.round,
          outcome: state,
          score: state === 'pending' || state === 'excluded' ? null : effectiveMargin,
        });
      }
    }
  } else {
    const mp = (event.pairMethod ?? 'mp') === 'mp';
    const rounds = new Map<
      string,
      { id: string; round: number; sum: number; top: number; pending: boolean; valid: number }
    >();
    for (const a of event.assignments)
      for (const [id, side] of [
        [a.ns, 'ns'],
        [a.ew, 'ew'],
      ] as const) {
        const key = id + ':' + a.round;
        const aggregate = rounds.get(key) ?? {
          id,
          round: a.round,
          sum: 0,
          top: 0,
          pending: false,
          valid: 0,
        };
        rounds.set(key, aggregate);
        for (const board of a.boards) {
          const result = event.results[resultKey(a.id, board)];
          const score = event.projection.pairScores[resultKey(a.id, board)];
          if (!result || !score) {
            aggregate.pending = true;
            continue;
          }
          if (score.cancelled) continue;
          if (score.provisional) aggregate.pending = true;
          if (score[side] === null) continue;
          aggregate.sum += score[side];
          aggregate.top += score.top;
          aggregate.valid++;
        }
      }
    for (const [key, r] of rounds) {
      const margin = mp ? r.sum - r.top / 2 : r.sum;
      const state = r.pending ? 'pending' : !r.valid ? 'excluded' : outcome(margin);
      add(r.id, {
        key,
        round: r.round,
        outcome: state,
        score:
          state === 'pending' || state === 'excluded' ? null : mp ? (100 * r.sum) / r.top : r.sum,
      });
    }
  }
  const weights = event.winAward ?? { win: 2, loss: 0, draw: 1 };
  for (const row of rows) {
    row.units = row.win * weights.win + row.loss * weights.loss + row.draw * weights.draw;
    row.entries.sort((a, b) => a.round - b.round || a.key.localeCompare(b.key));
  }
  return rows;
}
