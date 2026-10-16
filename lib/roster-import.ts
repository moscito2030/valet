import type { BridgeEvent } from './model';
import { parseCsv } from './imports';

type Source = Pick<BridgeEvent, 'kind' | 'participants' | 'assignments'>;
// Escape formula prefixes and existing apostrophes reversibly for spreadsheet exports.
function cell(value: string) {
  const safe = /^[\s]*[=+@\-']/.test(value) ? "'" + value : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
function decode(value: string) {
  return /^'[\s]*[=+@\-']/.test(value) ? value.slice(1) : value;
}
export function exportRosters(event: Source) {
  return 'teamId,teamName,captain,players\n' + event.participants.map(p =>
    [p.id, p.name, p.captain ?? '', p.players].map(cell).join(','),
  ).join('\n');
}
export function parseRosters(csv: string, event: Source) {
  if (event.kind !== 'teams') throw new Error('隊伍賽員名單僅適用隊制賽');
  const seen = new Set<string>();
  return parseCsv(csv).map(row => {
    if (!['teamId', 'captain', 'players'].every(key => Object.hasOwn(row, key)))
      throw new Error('欄位須包含 teamId,captain,players');
    const id = decode(row.teamId);
    const team = event.participants.find(p => p.id === id);
    if (!team) throw new Error(`找不到隊伍：${id}`);
    if (seen.has(id)) throw new Error(`隊伍 ${id} 不可重複`);
    seen.add(id);
    const captain = decode(row.captain).trim();
    const players = decode(row.players).split(/[、\r\n]+/).map(n => n.trim()).filter(Boolean);
    if (captain.length > 80 || /[\r\n]/.test(captain)) throw new Error('隊長最多 80 字元，不可包含換行');
    if (players.length > 30 || players.some(n => n.length > 80)) throw new Error('每隊最多 30 人，姓名最多 80 字元');
    if (new Set(players).size !== players.length) throw new Error(`${team.name} 賽員不可重複`);
    for (const a of event.assignments) {
      for (const seat of ['N', 'E', 'S', 'W'] as const) {
        if ((seat === 'N' || seat === 'S' ? a.ns : a.ew) !== id) continue;
        const name = a.playerNames?.[seat];
        if (name && !players.includes(name)) throw new Error(`${team.name}：請先更新使用 ${name} 的入座名單`);
      }
    }
    return { participantId: id, teamName: team.name, captain, players };
  });
}
