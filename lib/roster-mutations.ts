import type { BridgeEvent, Mutation } from './model';
import { DomainError } from './domain-error';
import { validateInterleavedLineups } from './team-movement';
import { parseRosters } from './roster-import';
import { parseLineups, lineupRosterAdditions } from './lineup-import';
type RosterMutation = Extract<
  Mutation,
  { action: 'lineups-import' | 'rosters-import' | 'team-roster' | 'table-lineup' | 'pair-name' | 'participants-setup' }
>;
export function isRosterMutation(command: Mutation): command is RosterMutation {
  return ['lineups-import', 'rosters-import', 'team-roster', 'table-lineup', 'pair-name', 'participants-setup'].includes(
    command.action,
  );
}
export function applyRosterMutation(e: BridgeEvent, command: RosterMutation) {
  let detail = '';
  if (command.action === 'participants-setup') {
    if(e.status!=='live'||e.assignments.length||Object.keys(e.results).length||e.knockout||e.swiss||Object.keys(e.club?.tokens??{}).length)throw new DomainError('名單須在編排與簽發收分連結前設定；已有賽程請使用名稱修改功能');
    const count=command.names.length, mode=command.rankingMode??e.rankingMode??(e.participants.some(p=>p.group)?'double':'single');
    if(new Set(command.names).size!==count)throw new DomainError('名稱不可重複');
    if(e.kind==='teams'&&(count===1||count>32||command.rankingMode))throw new DomainError('隊制賽需 2–32 隊，或留空稍後設定');
    if(e.kind==='pairs'&&count>0&&(count<4||(mode==='double'&&(count<6||count%2))))throw new DomainError('雙人賽至少四對；Double Winner 須 NS／EW 各 3–40 對');
    if(e.participants.some(p=>!command.names.includes(p.name)&&(p.players||p.captain||e.penalties?.[p.id])))throw new DomainError('移除的隊伍已有賽員或判罰資料，請先處理原有資料');
    let next=Math.max(0,...e.participants.map(p=>Number(p.id.slice(1))||0))+1;
    e.participants=command.names.map((name,i)=>{
      const previous=e.participants.find(p=>p.name===name);
      const {group,...p}=previous??{id:(e.kind==='teams'?'t':'p')+next++,name,players:''};
      return {...p,...(e.kind==='pairs'&&mode==='double'?{group:i<count/2?'NS' as const:'EW' as const}:{})};
    });
    if(e.kind==='pairs')e.rankingMode=mode;
    if(e.kind==='teams'&&count%2&&e.byeVp===undefined)e.byeVp=e.teamMethod==='bam'?0:12;
    detail='設定 '+count+' 個參賽單位';
  } else if (command.action === 'pair-name') {
    const pair = e.participants.find(p => p.id === command.participantId);
    if (e.kind !== 'pairs' || !pair) throw new DomainError('找不到雙人賽搭檔');
    if (e.participants.some(p => p.id !== pair.id && p.name.trim() === command.name)) throw new DomainError('搭檔名稱不可重複');
    detail = `${pair.id}：${JSON.stringify(pair.name)} → ${JSON.stringify(command.name)}`;
    pair.name = command.name;
  } else if (command.action === 'lineups-import') {
    try {
      const updates = parseLineups(command.csv, e);
      const additions = lineupRosterAdditions(updates, e);
      for (const addition of additions) {
        const team = e.participants.find((p) => p.id === addition.teamId)!;
        team.players = [...team.players.split('、').filter(Boolean), ...addition.names].join('、');
      }
      detail = updates
        .map((u) => {
          const a = e.assignments.find((a) => a.id === u.assignmentId)!;
          const change = `${a.id}: ${JSON.stringify(a.playerNames ?? {})} → ${JSON.stringify(u.playerNames)}`;
          a.playerNames = u.playerNames;
          return change;
        })
        .join('；');
      if (additions.length)
        detail +=
          '；新增隊員：' + additions.map((a) => `${a.teamName}：${a.names.join('、')}`).join('；');
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
  } else if (command.action === 'rosters-import') {
    try {
      const updates = parseRosters(command.csv, e);
      detail = updates
        .map((u) => {
          const team = e.participants.find((p) => p.id === u.participantId)!;
          const before = JSON.stringify({ players: team.players, captain: team.captain ?? '' });
          team.players = u.players.join('、');
          team.captain = u.captain;
          return (
            team.name +
            '：' +
            before +
            ' → ' +
            JSON.stringify({ players: team.players, captain: team.captain })
          );
        })
        .join('；');
    } catch (error) {
      throw new DomainError((error as Error).message);
    }
  } else if (command.action === 'team-roster') {
    const p = e.participants.find((p) => p.id === command.participantId);
    if (e.kind !== 'teams' || !p) throw new DomainError('找不到隊伍');
    if (new Set(command.players).size !== command.players.length)
      throw new DomainError('賽員不可重複');
    const removed = (p.players || '').split('、').filter((n) => n && !command.players.includes(n));
    if (
      e.assignments.some((a) => Object.values(a.playerNames ?? {}).some((n) => removed.includes(n)))
    )
      throw new DomainError('請先更新使用此賽員的上場名單');
    p.players = command.players.join('、');
    p.captain = command.captain;
    detail = `${p.name}：${p.players}；隊長：${p.captain}`;
  } else if (command.action === 'table-lineup') {
    const a = e.assignments.find((a) => a.id === command.assignmentId);
    if (e.kind !== 'teams' || !a) throw new DomainError('找不到隊制桌次');
    const names = Object.values(command.playerNames).filter(Boolean);
    if (new Set(names).size !== names.length) throw new DomainError('同桌賽員不可重複');
    if (
      e.assignments.some(
        (other) =>
          other.id !== a.id &&
          other.round === a.round &&
          Object.values(other.playerNames ?? {}).some((name) => names.includes(name)),
      )
    )
      throw new DomainError('同一圈賽員不可同時在其他桌上場');
    for (const seat of ['N', 'E', 'S', 'W'] as const) {
      const p = e.participants.find((p) => p.id === (seat === 'N' || seat === 'S' ? a.ns : a.ew))!;
      if (command.playerNames[seat] && !p.players.split('、').includes(command.playerNames[seat]))
        throw new DomainError(`${seat} 姓名不在該隊名單`);
    }
    a.playerNames = command.playerNames;
    try { validateInterleavedLineups(e.assignments); }
    catch (error) { throw new DomainError((error as Error).message); }
    detail = `${a.id}：${JSON.stringify(a.playerNames)}`;
  }
  return detail;
}
