import {
  APPENDIX_BASES,
  buildAppendixMitchell,
  isInterwovenRecord,
  sessionsHaveDistinctOpponents,
} from './appendix-mitchell';
import { MAX_PLAYER_BOARDS, playerBoardError } from './schedule-limits';
import templates from './movement-templates.json';
import acblMovements from './acbl-movements.json';
import howellRecords from './acbl-howell-records.json';
import { decodeAcblHowell } from './acbl-howell';
import roverRecords from './acbl-rover-records.json';
import { decodeAcblRover } from './acbl-rover';
import { buildAcblWeb } from './acbl-web';
import { buildAcblAppendix } from './acbl-appendix';
import { parseAcblMovement, type AcblMovement } from './acbl-movement';
import type { Assignment, BridgeEvent } from './model';
import {
  interleavedAssignments,
  teamByes,
  type InterleavedGroups,
  type InterleavedSize,
} from './team-movement';

export type MovementPlan = {
  id: string;
  label: string;
  groups: number;
  note: string;
  source?: string;
  sessionNote?: string;
  interleavedSize?: InterleavedSize;
  interleavedMode?: 'rotation' | 'symmetric';
};
const officialMovements: AcblMovement[] = [
  ...acblMovements,
  ...howellRecords.map((record) => decodeAcblHowell(record.name, record.text)),
  ...roverRecords.flatMap((record) => [
    decodeAcblRover(record.name, record.text),
    decodeAcblRover(`EW-${record.name}`, record.text, 'EW'),
  ]),
];
const interwovenNames = new Set(
  howellRecords.filter((r) => isInterwovenRecord(r.text)).map((r) => r.name),
);
const interwovenMovements = officialMovements.filter((m) => interwovenNames.has(m.name));
function appendixMovements(tables: number) {
  return APPENDIX_BASES.filter((r) => tables > r && tables <= 2 * r).map((r) =>
    buildAppendixMitchell(tables, r),
  );
}
function ordinaryFirstSessions(tables: number): AcblMovement[] {
  return (
    tables % 2
      ? [{ name: '單套牌 Mitchell', rounds: tables - 1, relay: false }]
      : [
          { name: '單套牌 Mitchell', rounds: tables - 1, relay: false },
          { name: '雙套牌 Mitchell', rounds: tables, relay: true },
        ]
  ).map(({ name, rounds, relay }) => ({
    name,
    tables,
    rounds,
    pairCount: tables * 2,
    oneWinner: true,
    nsCount: tables,
    groups: tables,
    rows: Array.from({ length: rounds }, (_, r) =>
      Array.from({ length: tables }, (_, t) => [
        t + 1,
        tables +
          ((t - r - (!relay && tables % 2 === 0 && r >= tables / 2 ? 1 : 0) + tables * 2) %
            tables) +
          1,
        ((t + r + (relay && t >= tables / 2 ? 1 : 0)) % tables) + 1,
      ]),
    ),
  }));
}
function sessionNote(m: AcblMovement): string | undefined {
  const prefix =
    '兩賽段須使用相同搭檔對照：名單前半為 A 組、後半為 B 組；第二賽段使用全新的實體牌，不能重打第一賽段的牌。此提示不會自動建立第二賽段或合併總分。';
  if (m.name.startsWith('APPENDIX-T')) {
    const partners = interwovenMovements.filter((i) => sessionsHaveDistinctOpponents(m, i));
    return (
      prefix +
      ' 第二賽段可搭配：' +
      (partners.length
        ? partners.map((i) => 'Interwoven Howell ' + i.name + '（' + i.rounds + ' 圈）').join('、')
        : '目前內建資料尚無已驗證的不重複對手搭配，請勿任選同桌數 Howell。')
    );
  }
  if (interwovenNames.has(m.name)) {
    const partners = [...appendixMovements(m.tables), ...ordinaryFirstSessions(m.tables)].filter(
      (a) => sessionsHaveDistinctOpponents(a, m),
    );
    return (
      prefix +
      ' 第一賽段可搭配：' +
      (partners.length
        ? partners
            .map(
              (a) =>
                (a.name.startsWith('APPENDIX-T') ? 'Appendix Mitchell' : a.name) +
                '（' +
                a.tables +
                ' 桌 ' +
                a.rounds +
                ' 圈）',
            )
            .join('、')
        : '目前未提供已驗證的 Appendix Mitchell 搭配。一般 Mitchell 也須另外核對跨組對戰與刪圈，不能直接假定相容。')
    );
  }
}
function availableOfficialMovements(tables: number): AcblMovement[] {
  const webs: AcblMovement[] = [];
  if (tables % 2 === 0)
    for (let rounds = 3; rounds < tables; rounds++) {
      if (rounds % 2) webs.push(buildAcblWeb(tables, rounds));
    }
  return [
    ...officialMovements,
    ...webs,
    ...appendixMovements(tables),
    ...(tables >= 5 && tables <= 40 ? [buildAcblAppendix(tables - 1)] : []),
  ];
}
export type PairMovementSettings = {
  barometer?: boolean;
  phantom?: number;
  pairOrder?: string[];
  groupOrder?: number[];
};
type Input = Pick<
  BridgeEvent,
  'participants' | 'rounds' | 'boardsPerRound' | 'kind' | 'byeVp' | 'teamMethod'
>;
export function movementOptions(event: Input, external?: AcblMovement): MovementPlan[] {
  if (!Number.isInteger(event.rounds) || event.rounds < 1 || event.rounds > MAX_PLAYER_BOARDS)
    return [];
  if (event.kind === 'teams') {
    const n = event.participants.length;
    if (n < 2 || n > 32) return [];
    const options: MovementPlan[] = [
      {
        id: 'team-round-robin',
        label: n % 2 ? '隊制循環對戰（每圈一隊輪空）' : '隊制循環對戰',
        groups: event.rounds,
        note: `每場對戰安排開室與閉室，兩室交換方向；每圈使用新牌組。${n % 2 ? `完整一循環需 ${n} 圈，每隊輪空一次；可安排部分圈次。輪空不計 IMP 或實打牌數。` : ''}`,
      },
    ];
    for (const size of [3, 5] as const)
      if (n % size === 0 && event.rounds % (size - 1) === 0) {
        const cycles = event.rounds / (size - 1);
        options.push({
          id: 'team-interleaved-' + size,
          interleavedSize: size,
          label: size === 3 ? '三角對抗' : '對稱式五角對抗',
          groups: size * cycles,
          note:
            n +
            ' 張實體桌，每循環 ' +
            n / size +
            ' 組、每組 ' +
            size +
            ' 隊，共 ' +
            cycles +
            ' 個循環。各循環可重新分組；循環內固定南北／東西搭檔，依預覽移動。正反方向兩桌收齊後完成比較，' +
            (event.teamMethod === 'bam'
              ? '每牌依勝／和／負直接累計 VP；全賽每隊 '
              : '每場按每圈牌數換算 20–0 VP；全賽每隊 ') +
            event.rounds +
            ' 場。不同循環使用新牌組，各組同牌號需準備複製牌。開／閉為比較方向，非固定房間。',
        });
        if (size === 5) {
          const symmetric = options[options.length - 1];
          options.splice(options.length - 1, 0, {
            ...symmetric,
            id: 'team-interleaved-5-rotation',
            interleavedMode: 'rotation',
            label: '米契爾式五角對抗',
            note:
              '南北固定，東西與牌組每圈按固定方向輪轉。依對稱式五角對抗的第 1、3、4、2 小圈順序編排，再依實際順序標為 1、2、3、4。' +
              symmetric.note,
          });
        }
      }
    return options;
  }
  const tables = Math.ceil(event.participants.length / 2),
    rounds = event.rounds;
  const options: MovementPlan[] = [
    {
      id: 'barometer',
      label: '全場共牌 Mitchell',
      groups: rounds,
      note: '每圈各桌打相同牌組，須準備多份複製牌。',
    },
  ];
  const max = tables % 2 ? tables : tables - 1;
  if (rounds <= max)
    options.push({
      id: 'mitchell',
      label: '單套牌 Mitchell',
      groups: tables,
      note:
        tables % 2
          ? '南北固定，東西每圈往下一桌，牌組反向移動。'
          : `南北固定，東西每圈往下一桌；第 ${tables / 2} 圈結束後跳過一桌。`,
    });
  if (tables % 2 === 0 && rounds <= tables)
    options.push({
      id: 'mitchell-relay',
      label: '雙套牌 Mitchell',
      groups: tables,
      note: `南北固定、東西每圈往下一桌；第 1 與第 ${tables} 桌共用牌組，第 ${tables / 2} 與第 ${tables / 2 + 1} 桌之間設中繼牌桌。`,
    });
  for (const template of templates.filter((t) => t.tables === tables && t.rounds === rounds)) {
    options.push({
      id: `howell-${template.id}`,
      label: rounds === tables * 2 - 1 ? '完整 Howell' : '部分 Howell',
      groups: Math.max(...template.rows.flat().map((cell) => cell[2])),
      note: '搭檔依編排表輪換桌次與南北／東西方向；請依預覽的各圈桌次、方向與牌號移動。',
      source: template.source,
    });
  }
  if (event.participants.length % 2 === 0 && tables >= 3 && tables <= 40) {
    if (rounds <= tables)
      options.push({
        id: 'double-barometer',
        label: '雙冠軍・全場共牌 Mitchell',
        groups: rounds,
        note: 'NS 固定，EW 每圈往下一桌（末桌回第 1 桌），不跳桌。每圈各桌打相同的新牌組，須準備各桌複製牌。名單前半為 NS 組、後半為 EW 組，各組獨立排名；最多桌數圈。',
      });
    for (const option of [...options].filter((o) => o.id.startsWith('mitchell')))
      options.push({
        ...option,
        id: `double-${option.id}`,
        label: `雙冠軍・${option.label}`,
        note: `${option.note} 名單前半為 NS 組、後半為 EW 組，各組獨立排名。`,
      });
  }
  for (const movement of [...availableOfficialMovements(tables), ...(external ? [external] : [])]) {
    if (
      movement.name.startsWith('APPENDIX-T') &&
      (movement.rounds !== rounds || event.participants.length !== movement.pairCount)
    )
      continue;
    if (
      ![
        event.participants.length,
        event.participants.length % 2 ? event.participants.length + 1 : -1,
      ].includes(movement.pairCount) ||
      movement.rounds < rounds
    )
      continue;
    const family =
      movement.name === 'uploaded.MOV'
        ? '匯入編排'
        : movement.name.startsWith('WBMP')
          ? '輪休 Web'
          : movement.name.startsWith('W')
            ? 'Web 編排'
            : movement.name.startsWith('APPENDIX-T')
              ? 'Appendix Mitchell'
              : movement.name.startsWith('APPENDIX')
                ? '1½-table Appendix Mitchell'
                : interwovenNames.has(movement.name)
                  ? 'Interwoven Howell'
                  : movement.name.startsWith('EW-R')
                    ? '東西輪休 Mitchell'
                    : movement.name.startsWith('R')
                      ? '南北輪休 Mitchell'
                      : movement.name.startsWith('SM')
                        ? '交換方位 Mitchell'
                        : movement.name.startsWith('BL')
                          ? 'Blackpool 編排'
                          : movement.name.includes('ROVER')
                            ? '輪休 Howell'
                            : movement.name.startsWith('H')
                              ? 'Howell 編排'
                              : movement.name.startsWith('M06')
                                ? '剪式 Mitchell'
                                : movement.name.startsWith('M08')
                                  ? '交叉式 Mitchell'
                                  : '跨區 Mitchell';
    const option = {
      id: `acbl-${movement.name}`,
      label:
        movement.name === 'uploaded.MOV'
          ? family
          : `${family} · ${movement.name}${movement.rounds !== rounds ? `（取前 ${rounds}／${movement.rounds} 圈）` : ''}`,
      groups: movement.groups,
      sessionNote:
        event.participants.length === movement.pairCount
          ? sessionNote(movement)
          : interwovenNames.has(movement.name)
            ? '此為缺對版本；兩賽段搭檔對照與輪空位置須一致，尚未提供自動驗證的搭配。'
            : undefined,
      note: `${movement.name === 'uploaded.MOV' ? '匯入的 ACBLscore 編排。' : movement.name.startsWith('APPENDIX-T') ? '附桌輪轉編排：部分 NS 與 EW 固定，其他搭檔依預覽移動；附桌與基本桌共牌，請準備複製牌或安排共牌。單冠軍可設定交換方位，雙冠軍維持方向。' : 'ACBLscore 8.33 編排。'}共 ${movement.tables} 個桌位、${rounds} 圈，依預覽的桌次、方向與牌號移動；空桌不登分。${['M0612.MOV', 'H0310.MOV', 'H7ROVER.MOV', 'H8ROVER.MOV'].includes(movement.name) ? '原編排的半圈分別作為獨立圈次，請按每個半圈設定牌數與切換進度。' : ''}`,
      source: movement.name.startsWith('APPENDIX-T')
        ? 'https://forums.ebu.co.uk/discussion/843/eddy-appendix-mitchell-movements'
        : movement.name === 'uploaded.MOV'
          ? undefined
          : 'https://www.acbl.org/getscore/',
    };
    options.push(option);
    if (!movement.oneWinner)
      options.push({
        ...option,
        id: `double-${option.id}`,
        label: `雙冠軍・${option.label}`,
        note: option.note + ` 名單前 ${movement.nsCount} 對為 NS 組，其餘為 EW 組，各組獨立排名。`,
      });
  }
  return options;
}

export function movementBoardError(boardsPerRound: number): string | null {
  if (!Number.isInteger(boardsPerRound) || boardsPerRound < 1 || boardsPerRound > 16)
    return '每圈牌數須為 1–16 的整數。';
  return null;
}

export function buildMovement(
  event: Input,
  id: string,
  groups?: InterleavedGroups,
  arrowSwitchRound?: number,
  movementFile?: number[],
  settings: PairMovementSettings = {},
) {
  // Preserve callers of the original single-ring plan.
  if (id === 'team-interleaved' && [3, 5].includes(event.participants.length))
    id += '-' + event.participants.length;
  const playerError = playerBoardError(event.rounds, event.boardsPerRound);
  if (playerError) throw new Error(playerError);
  if (movementFile && !['acbl-uploaded.MOV', 'double-acbl-uploaded.MOV'].includes(id))
    throw new Error('匯入檔案與編排選項不符');
  const external = movementFile
    ? parseAcblMovement(Uint8Array.from(movementFile), 'uploaded.MOV')
    : undefined;
  const option = movementOptions(event, external).find((option) => option.id === id);
  if (!option) throw new Error('此桌數與圈數不適用所選賽程編排');
  const boardError = movementBoardError(event.boardsPerRound);
  if (boardError) throw new Error(boardError);
  if (groups && !option.interleavedSize) throw new Error('僅交錯循環可設定分組');
  const doubleWinner = id.startsWith('double-');
  if (doubleWinner) id = id.slice(7);
  const tables = Math.ceil(event.participants.length / 2);
  const acbl =
    id === 'acbl-uploaded.MOV'
      ? external
      : availableOfficialMovements(tables).find((m) => `acbl-${m.name}` === id);
  if (event.kind !== 'pairs' && Object.keys(settings).length) throw new Error('此設定僅適用雙人賽');
  const order = settings.pairOrder ?? event.participants.map((p) => p.id);
  if (
    order.length !== event.participants.length ||
    new Set(order).size !== order.length ||
    order.some((id) => !event.participants.some((p) => p.id === id))
  )
    throw new Error('搭檔對照必須完整且不得重複');
  const hasPhantom = acbl
    ? acbl.pairCount === event.participants.length + 1
    : event.participants.length % 2 === 1;
  const capacity = acbl?.pairCount ?? tables * 2;
  const phantom = hasPhantom ? (settings.phantom ?? capacity) : 0;
  if (
    settings.phantom !== undefined &&
    (!hasPhantom || !Number.isInteger(phantom) || phantom < 1 || phantom > capacity)
  )
    throw new Error('輪空搭檔編號不適用此編排');
  const slots = Array.from({ length: capacity }, (_, i) =>
    i + 1 === phantom ? undefined : order[i - (phantom && i + 1 > phantom ? 1 : 0)],
  );
  const participants = event.participants.map((p) => {
    const { group, ...rest } = p;
    return {
      ...rest,
      ...(doubleWinner
        ? {
            group:
              slots.indexOf(p.id) < (acbl?.nsCount ?? tables) ? ('NS' as const) : ('EW' as const),
          }
        : {}),
    };
  });
  const groupCount = settings.barometer ? event.rounds : option.groups;
  if (
    settings.groupOrder &&
    (settings.groupOrder.length !== groupCount ||
      new Set(settings.groupOrder).size !== groupCount ||
      settings.groupOrder.some((n) => !Number.isInteger(n) || n < 1 || n > groupCount))
  )
    throw new Error(`牌組對照須包含 1–${groupCount}，不得重複或遺漏`);
  const switchable =
    !doubleWinner &&
    event.kind === 'pairs' &&
    (id === 'mitchell' || id === 'mitchell-relay' || id.startsWith('acbl-APPENDIX-T'));
  const switchRound = arrowSwitchRound ?? Math.floor(event.rounds / 2) + 1;
  if (arrowSwitchRound !== undefined && !switchable)
    throw new Error('交換方位僅適用單冠軍米契爾編排');
  if (
    switchable &&
    (!Number.isInteger(switchRound) || switchRound < 0 || switchRound > event.rounds)
  )
    throw new Error('交換方位圈次須在賽程範圍內');
  if (switchable)
    option.note +=
      switchRound === 0
        ? ' 全程不交換方位。'
        : ` 從第 ${switchRound} 圈起交換所有桌的南北／東西方向，之後維持交換；移動路線與牌組不變。`;
  const assignments: Assignment[] = [];
  function add(round: number, table: number, nsIndex: number, ewIndex: number, group: number) {
    let ns = slots[nsIndex - 1],
      ew = slots[ewIndex - 1];
    if (switchable && switchRound > 0 && round >= switchRound) [ns, ew] = [ew, ns];
    if (!ns || !ew) return;
    if (settings.barometer) group = round;
    if (settings.groupOrder) group = settings.groupOrder[group - 1];
    assignments.push({
      id: `r${round}t${table}`,
      matchId: `r${round}t${table}`,
      round,
      table,
      room: 'pairs',
      ns,
      ew,
      boards: Array.from(
        { length: event.boardsPerRound },
        (_, i) => (group - 1) * event.boardsPerRound + i + 1,
      ),
    });
  }
  if (option.interleavedSize) {
    assignments.push(
      ...interleavedAssignments(event, option.interleavedSize, groups, option.interleavedMode),
    );
  } else if (acbl) {
    acbl.rows.slice(0, event.rounds).forEach((row, r) =>
      row.forEach((cell, t) => {
        if (cell) add(r + 1, t + 1, cell[0], cell[1], cell[2]);
      }),
    );
  } else if (id.startsWith('howell-')) {
    const template = templates.find((t) => `howell-${t.id}` === id)!;
    template.rows.forEach((row, r) =>
      row.forEach(([ns, ew, group], t) => add(r + 1, t + 1, ns, ew, group)),
    );
  } else if (doubleWinner && id === 'barometer') {
    for (let r = 0; r < event.rounds; r++) {
      for (let t = 0; t < tables; t++)
        add(r + 1, t + 1, t + 1, tables + ((t - r + tables) % tables) + 1, r + 1);
    }
  } else if (id === 'mitchell' || id === 'mitchell-relay') {
    for (let r = 0; r < event.rounds; r++) {
      const skip = id === 'mitchell' && tables % 2 === 0 && r >= tables / 2 ? 1 : 0;
      for (let t = 0; t < tables; t++)
        add(
          r + 1,
          t + 1,
          t + 1,
          tables + ((t - r - skip + tables * 2) % tables) + 1,
          ((t + r + (id === 'mitchell-relay' && t >= tables / 2 ? 1 : 0)) % tables) + 1,
        );
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
      assignments.push(
        { ...a, id: `${a.id}o`, room: 'open', ns, ew },
        { ...a, id: `${a.id}c`, room: 'closed', ns: ew, ew: ns },
      );
    }
  }
  const simultaneous = new Map<string, number>();
  for (const assignment of assignments)
    for (const board of assignment.boards) {
      const key = `${assignment.round}:${board}`;
      simultaneous.set(key, (simultaneous.get(key) ?? 0) + 1);
    }
  const copies = Math.max(1, ...simultaneous.values());
  if (settings.barometer) option.note += ' 各圈改用全場共牌。';
  if (phantom) option.note += ` 編排位置 ${phantom} 輪空，其餘依搭檔對照入座。`;
  if (settings.groupOrder) option.note += ` 牌組對照：${settings.groupOrder.join('、')}。`;
  return {
    option,
    participants,
    assignments,
    byes: teamByes({ ...event, assignments }),
    boardCount: groupCount * event.boardsPerRound,
    shared: copies > 1,
    copies,
    hasPhantom,
    capacity,
  };
}
