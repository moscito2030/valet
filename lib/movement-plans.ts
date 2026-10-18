import { MAX_PLAYER_BOARDS, playerBoardError } from './schedule-limits';
import templates from './movement-templates.json';
import type { Assignment, BridgeEvent } from './model';
import { interleavedAssignments, teamByes, type InterleavedGroups, type InterleavedSize } from './team-movement';

export type MovementPlan = { id: string; label: string; groups: number; note: string; source?: string; interleavedSize?: InterleavedSize; interleavedMode?: 'rotation' | 'symmetric' };
type Input = Pick<BridgeEvent, 'participants' | 'rounds' | 'boardsPerRound' | 'kind' | 'byeVp'>;
export function movementOptions(event: Input): MovementPlan[] {
  if (!Number.isInteger(event.rounds) || event.rounds < 1 || event.rounds > MAX_PLAYER_BOARDS) return [];
  if (event.kind === 'teams') {
    const n = event.participants.length;
    if (n < 3 || n > 32) return [];
    const options: MovementPlan[] = [{ id: 'team-round-robin', label: n % 2 ? '隊制循環對戰（每圈一隊輪空）' : '隊制循環對戰', groups: event.rounds,
      note: `每場對戰安排開室與閉室，兩室交換方向；每圈使用新牌組。${n % 2 ? `完整一循環需 ${n} 圈，每隊輪空一次；可安排部分圈次。輪空不計 IMP 或實打牌數。` : ''}` }];
    for (const size of [3, 5] as const) if (n % size === 0 && event.rounds % (size - 1) === 0) {
      const cycles = event.rounds / (size - 1);
      options.push({ id: 'team-interleaved-' + size, interleavedSize: size,
        label: (size === 3 ? '三隊交錯循環（全員打牌）' : '五隊交錯循環') , groups: size * cycles,
        note: n + ' 張實體桌，每循環 ' + (n / size) + ' 組、每組 ' + size + ' 隊，共 ' + cycles + ' 個循環。各循環可重新分組；循環內固定南北／東西搭檔，依預覽移動。正反方向兩桌收齊後完成比較，每場按每圈牌數換算 20–0 VP；全賽每隊 ' + event.rounds + ' 場。不同循環使用新牌組，各組同牌號需準備複製牌。開／閉為比較方向，非固定房間。' });
      if (size === 5) {
        const symmetric = options[options.length - 1];
        options.splice(options.length - 1, 0, {
          ...symmetric, id: 'team-interleaved-5-rotation', interleavedMode: 'rotation',
          label: '米契爾式五角對抗',
          note: '南北固定，東西與牌組每圈按固定方向輪轉。依五隊交錯循環的第 1、3、4、2 小圈順序編排，再依實際順序標為 1、2、3、4。' + symmetric.note,
        });
      }
    }
    return options;
  }
  const tables = Math.ceil(event.participants.length / 2), rounds = event.rounds;
  const options: MovementPlan[] = [{ id: 'barometer', label: '全場共牌 Mitchell', groups: rounds, note: '每圈各桌打相同牌組，須準備多份複製牌。' }];
  const max = tables % 2 ? tables : tables - 1;
  if (rounds <= max) options.push({ id: 'mitchell', label: '單套牌 Mitchell', groups: tables,
    note: tables % 2 ? '南北固定，東西每圈往下一桌，牌組反向移動。' : `南北固定，東西每圈往下一桌；第 ${tables / 2} 圈結束後跳過一桌。` });
  if (tables % 2 === 0 && rounds <= tables) options.push({ id: 'mitchell-relay', label: '雙套牌 Mitchell', groups: tables,
    note: `南北固定、東西每圈往下一桌；第 1 與第 ${tables} 桌共用牌組，第 ${tables / 2} 與第 ${tables / 2 + 1} 桌之間設中繼牌桌。` });
  for (const template of templates.filter(t => t.tables === tables && t.rounds === rounds)) {
    options.push({ id: `howell-${template.id}`, label: rounds === tables * 2 - 1 ? '完整 Howell' : '部分 Howell', groups: Math.max(...template.rows.flat().map(cell => cell[2])),
      note: '搭檔依編排表輪換桌次與南北／東西方向；請依預覽的各圈桌次、方向與牌號移動。', source: template.source });
  }
  if (event.participants.length % 2 === 0 && tables >= 3 && tables <= 32) {
    if (rounds <= tables) options.push({ id: 'double-barometer', label: '雙冠軍・全場共牌 Mitchell', groups: rounds,
      note: 'NS 固定，EW 每圈往下一桌（末桌回第 1 桌），不跳桌。每圈各桌打相同的新牌組，須準備各桌複製牌。名單前半為 NS 組、後半為 EW 組，各組獨立排名；最多桌數圈。' });
    for (const option of [...options].filter(o => o.id.startsWith('mitchell')))
      options.push({ ...option, id: `double-${option.id}`, label: `雙冠軍・${option.label}`, note: `${option.note} 名單前半為 NS 組、後半為 EW 組，各組獨立排名。` });
  }
  return options;
}

export function movementBoardError(boardsPerRound: number): string | null {
  if (!Number.isInteger(boardsPerRound) || boardsPerRound < 1 || boardsPerRound > 16)
    return '每圈牌數須為 1–16 的整數。';
  return null;
}

export function buildMovement(event: Input, id: string, groups?: InterleavedGroups, arrowSwitchRound?: number) {
  // Preserve callers of the original single-ring plan.
  if (id === 'team-interleaved' && [3, 5].includes(event.participants.length)) id += '-' + event.participants.length;
  const playerError = playerBoardError(event.rounds, event.boardsPerRound);
  if (playerError) throw new Error(playerError);
  const option = movementOptions(event).find(option => option.id === id);
  if (!option) throw new Error('此桌數與圈數不適用所選賽程編排');
  const boardError = movementBoardError(event.boardsPerRound);
  if (boardError) throw new Error(boardError);
  if (groups && !option.interleavedSize) throw new Error('僅交錯循環可設定分組');
  const doubleWinner = id.startsWith('double-');
  if (doubleWinner) id = id.slice(7);
  const tables = Math.ceil(event.participants.length / 2);
  const participants = event.participants.map((p, i) => {
    const { group, ...rest } = p;
    return { ...rest, ...(doubleWinner ? { group: i < tables ? 'NS' as const : 'EW' as const } : {}) };
  });
  const switchable = !doubleWinner && event.kind === 'pairs' && (id === 'mitchell' || id === 'mitchell-relay');
  const switchRound = arrowSwitchRound ?? Math.floor(event.rounds / 2) + 1;
  if (arrowSwitchRound !== undefined && !switchable) throw new Error('交換方位僅適用單冠軍米契爾編排');
  if (switchable && (!Number.isInteger(switchRound) || switchRound < 0 || switchRound > event.rounds)) throw new Error('交換方位圈次須在賽程範圍內');
  if (switchable) option.note += switchRound === 0 ? ' 全程不交換方位。' : ` 從第 ${switchRound} 圈起交換所有桌的南北／東西方向，之後維持交換；移動路線與牌組不變。`;
  const assignments: Assignment[] = [];
  function add(round: number, table: number, nsIndex: number, ewIndex: number, group: number) {
    let ns = event.participants[nsIndex - 1]?.id, ew = event.participants[ewIndex - 1]?.id;
    if (switchable && switchRound > 0 && round >= switchRound) [ns, ew] = [ew, ns];
    if (!ns || !ew) return; // The absent highest-numbered pair is a phantom.
    assignments.push({ id: `r${round}t${table}`, matchId: `r${round}t${table}`, round, table, room: 'pairs', ns, ew,
      boards: Array.from({ length: event.boardsPerRound }, (_, i) => (group - 1) * event.boardsPerRound + i + 1) });
  }
  if (option.interleavedSize) {
    assignments.push(...interleavedAssignments(event, option.interleavedSize, groups, option.interleavedMode));
  } else if (id.startsWith('howell-')) {
    const template = templates.find(t => `howell-${t.id}` === id)!;
    template.rows.forEach((row, r) => row.forEach(([ns, ew, group], t) => add(r + 1, t + 1, ns, ew, group)));
  } else if (doubleWinner && id === 'barometer') {
    for (let r = 0; r < event.rounds; r++) {
      for (let t = 0; t < tables; t++) add(r + 1, t + 1, t + 1,
        tables + ((t - r + tables) % tables) + 1, r + 1);
    }
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
  if (event.kind === 'teams' && !option.interleavedSize) {
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
  return { option, participants, assignments, byes: teamByes({ ...event, assignments }), boardCount: option.groups * event.boardsPerRound, shared: copies > 1, copies };
}
