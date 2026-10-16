import templates from './movement-templates.json';
import type { Assignment, BridgeEvent } from './model';

export type MovementPlan = { id: string; label: string; groups: number; note: string; source?: string };
type Input = Pick<BridgeEvent, 'participants' | 'rounds' | 'boardsPerRound' | 'kind'>;
export function movementOptions(event: Input): MovementPlan[] {
  if (!Number.isInteger(event.rounds) || event.rounds < 1 || event.rounds > (event.kind === 'teams' ? 15 : 19) ||
      !Number.isInteger(event.boardsPerRound) || event.boardsPerRound < 1 || event.boardsPerRound > 32) return [];
  if (event.kind === 'teams') return event.rounds * event.boardsPerRound <= 128
    ? [{ id: 'team-round-robin', label: '隊制循環對戰', groups: event.rounds, note: '每場對戰安排開室與閉室，兩室交換方向；每圈使用新牌組。' }] : [];
  const tables = Math.ceil(event.participants.length / 2), rounds = event.rounds;
  const options: MovementPlan[] = [{ id: 'barometer', label: '全場同牌輪轉', groups: rounds, note: '每圈各桌打相同牌組，須準備多份複製牌。' }];
  const max = tables % 2 ? tables : tables - 1;
  if (rounds <= max) options.push({ id: 'mitchell', label: tables % 2 ? 'Mitchell' : 'Skip Mitchell', groups: tables,
    note: tables % 2 ? '南北固定，東西每圈往下一桌，牌組反向移動。' : `南北固定，東西每圈往下一桌；第 ${tables / 2} 圈結束後跳過一桌。` });
  if (tables % 2 === 0 && rounds <= tables) options.push({ id: 'mitchell-relay', label: 'Mitchell（共牌／中繼桌）', groups: tables,
    note: `南北固定、東西每圈往下一桌；第 1 與第 ${tables} 桌共用牌組，第 ${tables / 2} 與第 ${tables / 2 + 1} 桌之間設中繼牌桌。` });
  for (const template of templates.filter(t => t.tables === tables && t.rounds === rounds)) {
    options.push({ id: `howell-${template.id}`, label: rounds === tables * 2 - 1 ? '完整 Howell' : '3/4 Howell（Reduced Howell）', groups: Math.max(...template.rows.flat().map(cell => cell[2])),
      note: '請依預覽的各圈桌次、方向與牌號移動。', source: template.source });
  }
  if (event.participants.length % 2 === 0 && tables >= 3 && tables <= 19) {
    for (const option of [...options].filter(o => o.id.startsWith('mitchell')))
      options.push({ ...option, id: `double-${option.id}`, label: `Double Winner ${option.label}`, note: `${option.note} 名單前半為 NS 組、後半為 EW 組，各組獨立排名。` });
  }
  return options.filter(option => option.groups * event.boardsPerRound <= 128);
}

export function buildMovement(event: Input, id: string) {
  const option = movementOptions(event).find(option => option.id === id);
  if (!option) throw new Error('此桌數與圈數不適用所選賽程編排');
  const doubleWinner = id.startsWith('double-');
  if (doubleWinner) id = id.slice(7);
  const tables = Math.ceil(event.participants.length / 2);
  const participants = event.participants.map((p, i) => {
    const { group, ...rest } = p;
    return { ...rest, ...(doubleWinner ? { group: i < tables ? 'NS' as const : 'EW' as const } : {}) };
  });
  const assignments: Assignment[] = [];
  function add(round: number, table: number, nsIndex: number, ewIndex: number, group: number) {
    const ns = event.participants[nsIndex - 1]?.id, ew = event.participants[ewIndex - 1]?.id;
    if (!ns || !ew) return; // The absent highest-numbered pair is a phantom.
    assignments.push({ id: `r${round}t${table}`, matchId: `r${round}t${table}`, round, table, room: 'pairs', ns, ew,
      boards: Array.from({ length: event.boardsPerRound }, (_, i) => (group - 1) * event.boardsPerRound + i + 1) });
  }
  if (id.startsWith('howell-')) {
    const template = templates.find(t => `howell-${t.id}` === id)!;
    template.rows.forEach((row, r) => row.forEach(([ns, ew, group], t) => add(r + 1, t + 1, ns, ew, group)));
  } else if (id === 'mitchell' || id === 'mitchell-relay') {
    for (let r = 0; r < event.rounds; r++) {
      const skip = id === 'mitchell' && tables % 2 === 0 && r >= tables / 2 ? 1 : 0;
      for (let t = 0; t < tables; t++) add(r + 1, t + 1, t + 1,
        tables + ((t - r - skip + tables * 2) % tables) + 1, (t + r + (id === 'mitchell-relay' && t >= tables / 2 ? 1 : 0)) % tables + 1);
    }
  } else {
    const rotation = Array.from({ length: tables * 2 }, (_, i) => i + 1);
    for (let r = 1; r <= event.rounds; r++) {
      for (let t = 0; t < tables; t++) {
        const [a, b] = [rotation[t], rotation[rotation.length - 1 - t]];
        add(r, t + 1, (r + t) % 2 ? a : b, (r + t) % 2 ? b : a, r);
      }
      rotation.splice(1, 0, rotation.pop()!);
    }
  }
  if (event.kind === 'teams') {
    const pairs = assignments.splice(0);
    for (const a of pairs) {
      const [ns, ew] = Number(a.ns.slice(1)) < Number(a.ew.slice(1)) ? [a.ns, a.ew] : [a.ew, a.ns];
      assignments.push({ ...a, id: `${a.id}o`, room: 'open', ns, ew }, { ...a, id: `${a.id}c`, room: 'closed', ns: ew, ew: ns });
    }
  }
  const simultaneous = new Map<string, number>();
  for (const assignment of assignments) for (const board of assignment.boards) {
    const key = `${assignment.round}:${board}`;
    simultaneous.set(key, (simultaneous.get(key) ?? 0) + 1);
  }
  const copies = Math.max(1, ...simultaneous.values());
  return { option, participants, assignments, boardCount: option.groups * event.boardsPerRound, shared: copies > 1, copies };
}
