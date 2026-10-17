import type { Assignment, BridgeEvent } from './model';
import { isInterleaved } from './team-movement';

type Schedule = Pick<BridgeEvent, 'kind' | 'teamMovement' | 'assignments'>;

// In an interleaved movement, room is a comparison role, not a physical room.
const separateRooms = (event: Schedule) =>
  event.kind === 'teams' && !event.teamMovement && !isInterleaved(event.assignments);
const keyFor = (a: Assignment, rooms: boolean) =>
  JSON.stringify([String(a.table), rooms ? a.room : 'table']);
const labelFor = (a: Assignment, rooms: boolean) =>
  `第 ${a.table} 桌${rooms && a.room === 'open' ? ' · 開室' : rooms && a.room === 'closed' ? ' · 閉室' : ''}`;

export const tableDeviceKey = (event: Schedule, a: Assignment) => keyFor(a, separateRooms(event));

export function tableDeviceLabel(event: Schedule, a: Assignment) {
  return labelFor(a, separateRooms(event));
}

export function tableDevices(event: Schedule) {
  const rooms = separateRooms(event);
  return [
    ...new Map(
      event.assignments.map((a) => [
        keyFor(a, rooms),
        { key: keyFor(a, rooms), label: labelFor(a, rooms) },
      ]),
    ).values(),
  ];
}

export function deviceAssignment(event: Schedule, key: string, round: number) {
  const rooms = separateRooms(event);
  const rows = event.assignments.filter((a) => a.round === round && keyFor(a, rooms) === key);
  // Fail closed if an imported schedule ambiguously maps two seats to one device.
  return rows.length === 1 ? rows[0] : undefined;
}

export function validDeviceSchedule(event: Schedule) {
  const rooms = separateRooms(event);
  const keys = event.assignments.map((a) => `${a.round}:${keyFor(a, rooms)}`);
  return keys.length === new Set(keys).size;
}
