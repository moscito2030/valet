import type { BridgeEvent, Mutation } from './model';
import { DomainError } from './domain-error';
import { parseRosters } from './roster-import';
import { parseLineups, lineupRosterAdditions } from './lineup-import';
type RosterMutation = Extract<
  Mutation,
  { action: 'lineups-import' | 'rosters-import' | 'team-roster' | 'table-lineup' }
>;
export function isRosterMutation(command: Mutation): command is RosterMutation {
  return ['lineups-import', 'rosters-import', 'team-roster', 'table-lineup'].includes(
    command.action,
  );
}
export function applyRosterMutation(e: BridgeEvent, command: RosterMutation) {
  let detail = '';
  if (command.action === 'lineups-import') {
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
    detail = `${a.id}：${JSON.stringify(a.playerNames)}`;
  }
  return detail;
}
