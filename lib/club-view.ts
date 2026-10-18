import { clubAccepted, clubReviewVersion, clubRoles } from './club-confirmation';
import type { BridgeEvent } from './model';
import { resultKey } from './model';
import { deviceAssignment, tableDeviceLabel, tableDevices } from './table-device';
import { roundLabel } from './team-movement';
export { audienceEvent } from './read-models/public-event';

export function clubView(event: BridgeEvent, pair: string) {
  const round = event.currentRound ?? 0;
  const tableMode = event.club?.mode === 'table';
  const assignment = tableMode
    ? deviceAssignment(event, pair, round)
    : event.assignments.find((a) => a.round === round && (a.ns === pair || a.ew === pair));
  const roles = assignment ? clubRoles(event, assignment) : null;
  const accepted = !!assignment && clubAccepted(event, assignment);
  const showGuide =
    accepted ||
    event.roundPhase === 'break' ||
    (round > 0 && !assignment) ||
    event.status === 'finished';
  const nextRound = round + 1;
  const next = tableMode
    ? deviceAssignment(event, pair, nextRound)
    : event.assignments.find((a) => a.round === nextRound && (a.ns === pair || a.ew === pair));
  const nextTables = event.assignments.filter((a) => a.round === nextRound);
  const scheduledPairs = new Set(nextTables.flatMap((a) => [a.ns, a.ew]));
  // A missing seat is only a bye when the entire odd-pair round is scheduled.
  // An absent or partially prepared future round must remain pending.
  const nextBye =
    event.kind === 'pairs' &&
    event.participants.length % 2 === 1 &&
    nextTables.length === Math.floor(event.participants.length / 2) &&
    scheduledPairs.size === event.participants.length - 1 &&
    event.participants.some((p) => p.id === pair) &&
    !scheduledPairs.has(pair);
  const opponentId = next ? (next.ns === pair ? next.ew : next.ns) : null;
  const guide =
    tableMode || !showGuide
      ? null
      : event.status === 'finished' || (event.rounds > 0 && nextRound > event.rounds)
        ? { kind: 'complete' as const }
        : event.rounds === 0
          ? { kind: 'pending' as const }
          : next
            ? {
                kind: 'table' as const,
                round: nextRound,
                table: next.table,
                direction: next.ns === pair ? ('NS' as const) : ('EW' as const),
                opponentId: opponentId!,
                opponentName:
                  event.participants.find((p) => p.id === opponentId)?.name ?? opponentId!,
                boards: [...next.boards],
              }
            : nextBye
              ? { kind: 'bye' as const, round: nextRound }
              : { kind: 'pending' as const };
  return {
    mode: tableMode ? ('table' as const) : ('pair' as const),
    deviceLabel: tableMode
      ? (tableDevices(event).find((d) => d.key === pair)?.label ?? '桌次收分')
      : null,
    tableGuide:
      !tableMode || !showGuide
        ? null
        : event.status === 'finished' || (event.rounds > 0 && nextRound > event.rounds)
          ? { kind: 'complete' as const }
          : next
            ? {
                kind: 'table' as const,
                round: nextRound,
                roundLabel: roundLabel(event, nextRound),
                label: tableDeviceLabel(event, next),
                ns: event.participants.find((p) => p.id === next.ns)?.name ?? next.ns,
                ew: event.participants.find((p) => p.id === next.ew)?.name ?? next.ew,
                boards: [...next.boards],
              }
            : { kind: 'pending' as const },
    id: event.id,
    gameMode: event.gameMode ?? 'bridge',
    name: [event.competition?.prefix ?? event.prefix, event.stageName ?? event.name]
      .filter(Boolean)
      .join(' '),
    pair,
    pairName: event.participants.find((p) => p.id === pair)?.name ?? pair,
    round,
    roundLabel: roundLabel(event, round),
    phase: event.roundPhase,
    status: event.status,
    guide,
    locked: accepted,
    accepted,
    role: roles
      ? tableMode
        ? ('shared' as const)
        : roles.inputPair === pair
          ? ('input' as const)
          : ('confirm' as const)
      : null,
    roles,
    reviewVersion: assignment ? clubReviewVersion(event, assignment) : '',
    finalized: event.club?.finalized.includes(round) ?? false,
    assignment,
    names: assignment
      ? {
          ns: event.participants.find((p) => p.id === assignment.ns)?.name,
          ew: event.participants.find((p) => p.id === assignment.ew)?.name,
        }
      : null,
    boards: assignment
      ? event.boards
          .filter((b) => assignment.boards.includes(b.number))
          .map((b) => ({
            number: b.number,
            dealer: b.dealer,
            vulnerability: b.vulnerability,
            result: event.results[resultKey(assignment.id, b.number)] ?? null,
          }))
      : [],
  };
}
export type ClubView = ReturnType<typeof clubView>;
