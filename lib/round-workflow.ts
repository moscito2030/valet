import type { BridgeEvent } from './model';
import { clubAccepted, clubConfirmationKey } from './club-confirmation';
import { knockoutRoundReady } from './knockout';
import { swissRoundComplete } from './swiss';

type RoundEvent = Pick<
  BridgeEvent,
  'assignments' | 'results' | 'club' | 'rounds' | 'participants' | 'swiss' | 'knockout'
>;

export function roundStartProblem(event: RoundEvent, round: number): string | null {
  if (round < 1 || round > event.rounds) return '沒有下一圈。';
  if (!event.assignments.some((a) => a.round === round)) return '請先安排這一圈的賽程。';
  if (!knockoutRoundReady(event, round)) return '請先公布這一圈所有淘汰賽對局。';
  if (event.swiss && !swissRoundComplete(event, round)) return '請先完整公布這一圈對戰與輪空。';
  return null;
}

export function unsettledRoundsBefore(event: RoundEvent, round: number): number[] {
  if (!event.club?.enabled) return [];
  return [...new Set(event.assignments.filter((a) => a.round < round).map((a) => a.round))]
    .filter((r) => !event.club!.finalized.includes(r))
    .sort((a, b) => a - b);
}

export function clubRoundReady(event: RoundEvent, round: number): boolean {
  if (
    !event.club?.enabled ||
    event.club.finalized.includes(round) ||
    roundStartProblem(event, round)
  )
    return false;
  return event.assignments.filter((a) => a.round === round).every((a) => clubAccepted(event, a));
}

export function roundHasActivity(
  event: RoundEvent & Partial<Pick<BridgeEvent, 'audit'>>,
  round: number,
): boolean {
  const tables = event.assignments.filter((a) => a.round === round);
  const ids = new Set(tables.map((a) => a.id));
  return (
    !!event.club?.finalized.includes(round) ||
    Object.values(event.results).some((r) => ids.has(r.assignmentId)) ||
    tables.some((a) => !!event.club?.confirmations[clubConfirmationKey(event, a)]) ||
    !!event.audit?.some((entry) =>
      entry.changes?.some(
        (change) =>
          ids.has(change.before?.assignmentId ?? '') || ids.has(change.after?.assignmentId ?? ''),
      ),
    )
  );
}
