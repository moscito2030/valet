import { knockoutNodeSchema, type Knockout } from './knockout-schema';
import { MAX_PLAYER_BOARDS, playerBoardError } from './schedule-limits';
import { z } from 'zod';
import { recordedHcpSchema } from './recorded-hcp';
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    '日期不正確',
  );
export const seats = ['N', 'E', 'S', 'W'] as const;
export type Seat = (typeof seats)[number];
export type Kind = 'teams' | 'pairs';
export type PairMethod = 'mp' | 'crossimp' | 'butler';
export type Trim = 'none' | 'one' | 'ten-percent';
export type Vulnerability = 'None' | 'NS' | 'EW' | 'All';
export type Participant = {
  id: string;
  name: string;
  players: string;
  captain?: string;
  group?: 'NS' | 'EW';
};
export type CompetitionInfo = {
  archived?: boolean;
  id: string;
  name: string;
  prefix: string;
  venue: string;
  hasStages: boolean;
  revision: number;
};
export type Board = {
  number: number;
  group?: string;
  dealer: Seat;
  vulnerability: Vulnerability;
  deal: Record<Seat, string[]>;
  published?: boolean;
};
export type Assignment = {
  id: string;
  round: number;
  table: number | string;
  room: 'open' | 'closed' | 'pairs';
  ns: string;
  ew: string;
  boards: number[];
  matchId: string;
  playerNames?: Partial<Record<Seat, string>>;
};
export const resultSchema = z
  .object({
    assignmentId: z.string().min(1).max(100),
    board: z.number().int().min(1),
    level: z.number().int().min(0).max(7),
    strain: z.enum(['C', 'D', 'H', 'S', 'NT']),
    doubled: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    declarer: z.enum(seats),
    tricks: z.number().int().min(0).max(13),
    lead: z.string().max(4).default(''),
    miniBridge: z.boolean().optional(),
    hcp: recordedHcpSchema.optional(),
  })
  .strict()
  .refine(
    (r) => r.level !== 0 || (r.tricks === 0 && r.doubled === 1),
    'Pass out 必須是 0 墩、未加倍',
  );
export type ResultInput = z.infer<typeof resultSchema>;
export type Result = ResultInput & {
  split?: { ns: ResultInput & { nsScore: number }; ew: ResultInput & { nsScore: number } };
  nsScore: number;
  updatedAt: string;
  status?: 'played' | 'cancelled' | 'average';
};
export type Audit = {
  at: string;
  action: string;
  reason: string;
  revision: number;
  detail?: string;
  changes?: { key: string; before: Result | null; after: Result | null }[];
};
export type SwissPublication = {
  round: number;
  sourceRound: number;
  sourceRevision: number;
  at: string;
  pairs: [string, string][];
  bye?: string;
  basis: { id: string; vpA: number | null; vpB: number | null }[];
  byeBasis: { round: number; participantId: string; vp: number }[];
  scores: { id: string; score: number; ready: boolean }[];
};
export type SwissConfig = { mode: 'current' | 'delayed'; publications: SwissPublication[] };
export type BridgeEvent = {
  stageArchived?: boolean;
  // Legacy root stages retain their IDs; independent competition records own shared metadata.
  parentEventId?: string;
  stageName?: string;
  venueOverride?: string;
  hasStages?: boolean;
  competition?: CompetitionInfo;
  club?: {
    enabled: boolean;
    mode?: 'pair' | 'table';
    tokens: Record<string, string>;
    confirmations: Record<string, { at: string; forced: boolean; reviewVersion?: string }>;
    finalized: number[];
    inputRule?: 'ns' | 'ew' | 'lower' | 'higher';
    inputOverrides?: Record<string, string>;
  };
  id: string;
  name: string;
  prefix?: string;
  kind: Kind;
  rankingMode?: 'single' | 'double';
  gameMode?: 'bridge' | 'minibridge';
  teamMethod?: 'imp' | 'bam';
  teamFormat?: 'league' | 'knockout';
  bam?: { win: number; draw: number; loss: number };
  date: string;
  endDate?: string;
  venue: string;
  rounds: number;
  boardsPerRound: number;
  maxBoardNumber?: number;
  awardPlaces?: number;
  awardPlacesNS?: number;
  awardPlacesEW?: number;
  audienceRefreshSeconds?: number;
  danmakuDefaultEnabled?: boolean;
  showScoreCandles?: boolean;
  awardDescription?: string;
  winAward?: { enabled: boolean; win: number; loss: number; draw: number };
  movementDescription?: string;
  movementImported?: boolean;
  teamMovement?: 'interleaved';
  byeVp?: number;
  swiss?: SwissConfig;
  knockout?: Knockout;
  currentRound?: number;
  roundPhase?: 'playing' | 'break';
  roundTimes?: Record<number, { startAt: string; endAt: string }>;
  status: 'live' | 'review' | 'finished';
  publishBoards: boolean;
  pairMethod?: PairMethod;
  neuberg?: boolean;
  trim?: Trim;
  penalties?: Record<string, number>;
  demo: boolean;
  participants: Participant[];
  boards: Board[];
  assignments: Assignment[];
  results: Record<string, Result>;
  audit: Audit[];
  revision: number;
  updatedAt: string;
};
export const bamSchema = z
  .object({
    win: z.number().min(0).max(10000).multipleOf(0.01),
    draw: z.number().min(0).max(10000).multipleOf(0.01),
    loss: z.number().min(0).max(10000).multipleOf(0.01),
  })
  .strict();
export const createSchema = z
  .object({
    firstStageName: z.string().trim().min(1).max(80).optional(),
    name: z.string().trim().min(2).max(80),
    prefix: z.string().trim().max(80).optional(),
    kind: z.enum(['teams', 'pairs']),
    gameMode: z.enum(['bridge', 'minibridge']).optional(),
    teamMethod: z.enum(['imp', 'bam']).optional(),
    teamFormat: z.enum(['league', 'knockout']).optional(),
    bam: bamSchema.optional(),
    rankingMode: z.enum(['single', 'double']).optional(),
    movementPlan: z
      .enum(['double-mitchell', 'double-mitchell-relay', 'double-barometer'])
      .optional(),
    pairMethod: z.enum(['mp', 'crossimp', 'butler']).optional(),
    neuberg: z.boolean().optional(),
    trim: z.enum(['none', 'one', 'ten-percent']).optional(),
    date: dateSchema,
    endDate: dateSchema.optional(),
    venue: z.string().trim().max(80),
    venueOverride: z.string().trim().max(80).optional(),
    names: z.array(z.string().trim().min(1).max(60)).max(80),
    rounds: z.number().int().min(1).max(MAX_PLAYER_BOARDS).optional(),
    boardsPerRound: z.number().int().min(1).max(16).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.teamFormat && v.kind !== 'teams') ctx.addIssue({ code: 'custom', message: '隊制賽制不適用雙人賽' });
    if (v.teamFormat === 'knockout' && (v.kind !== 'teams' || v.teamMethod === 'bam' || v.names.length === 1))
      ctx.addIssue({ code: 'custom', message: '純 IMP 淘汰賽需至少兩隊，且使用 IMP 計分' });
    if (v.kind !== 'teams' && (v.teamMethod || v.bam))
      ctx.addIssue({ code: 'custom', message: 'BAM 計分僅適用隊制賽' });
    if (v.bam && v.teamMethod !== 'bam')
      ctx.addIssue({ code: 'custom', message: '請選擇 Board-A-Match 計分' });
    if (v.neuberg && (v.kind !== 'pairs' || (v.pairMethod ?? 'mp') !== 'mp'))
      ctx.addIssue({ code: 'custom', path: ['neuberg'], message: 'Neuberg 僅適用雙人賽 MP 計分' });
    if (v.rankingMode && (v.kind !== 'pairs' || v.movementPlan || v.rounds))
      ctx.addIssue({
        code: 'custom',
        message: '排名方式僅用於先建立雙人賽名單，賽程請於建立後設定',
      });
    if (v.rankingMode === 'double' && v.names.length > 0 && (v.names.length < 6 || v.names.length % 2))
      ctx.addIssue({ code: 'custom', message: 'Double Winner 需 NS／EW 各 3–40 組完整搭檔' });
    if (v.endDate && v.endDate < v.date)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: '結束日期不可早於開始日期' });
    if (v.kind === 'teams' && (v.names.length > 32 || v.movementPlan))
      ctx.addIssue({ code: 'custom', message: '隊制賽最多 32 隊，不適用雙冠軍編排' });
    const boardError = playerBoardError(v.rounds ?? 0, v.boardsPerRound ?? 0);
    if (boardError) ctx.addIssue({ code: 'custom', message: boardError });
    if (v.rounds && !v.boardsPerRound)
      ctx.addIssue({ code: 'custom', message: '設定圈數時請同時指定每圈牌數' });
    if (
      v.movementPlan &&
      (v.names.length < 6 ||
        v.names.length % 2 ||
        (v.movementPlan === 'double-mitchell-relay' && v.names.length % 4))
    )
      ctx.addIssue({ code: 'custom', message: '雙冠軍需 3–40 桌完整搭檔，共牌／中繼僅適用偶數桌' });
    if (new Set(v.names).size !== v.names.length)
      ctx.addIssue({ code: 'custom', message: '名稱不可重複' });
    if (v.names.length === 0 && (v.rounds || v.movementPlan)) ctx.addIssue({code:'custom', message:'請先設定名單，再安排賽程'});
    if (v.kind === 'teams' && v.names.length === 1) ctx.addIssue({code:'custom', message:'隊制賽至少兩隊'});
    if (v.kind === 'pairs' && v.names.length > 0 && v.names.length < 4)
      ctx.addIssue({ code: 'custom', message: '雙人賽至少四對' });
  });
export const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('knockout-adjust'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().min(2).max(200), nodeId: z.string().min(1).max(40), a: z.number().min(-10000).max(10000).multipleOf(0.01), b: z.number().min(-10000).max(10000).multipleOf(0.01) }).strict(),
  z.object({ action: z.literal('knockout-overtime'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().min(2).max(200), nodeId: z.string().min(1).max(40), boards: z.number().int().min(1).max(16) }).strict(),
  z.object({ action: z.literal('knockout-forfeit'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().min(2).max(200), nodeId: z.string().min(1).max(40), loser: z.string().min(1).max(80), withdraw: z.boolean() }).strict(),
 z.object({action:z.literal('participants-setup'),revision:z.number().int().min(1),requestId:z.string().uuid(),reason:z.string().trim().min(2).max(200),names:z.array(z.string().trim().min(1).max(60)).max(80),rankingMode:z.enum(['single','double']).optional()}).strict(),
  z
    .object({
      action: z.literal('knockout-config'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      nodes: z.array(knockoutNodeSchema).min(1).max(127),
    })
    .strict(),
  z
    .object({
      action: z.literal('knockout-publish'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal('knockout-decide'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      nodeId: z.string().min(1).max(40),
      winner: z.string().min(1).max(80).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('knockout-reopen'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      nodeId: z.string().min(1).max(40),
    })
    .strict(),
  z
    .object({
      action: z.literal('pair-name'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      participantId: z.string().min(1).max(100),
      name: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      action: z.literal('swiss-config'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      mode: z.enum(['current', 'delayed']),
      rounds: z.number().int().min(1).max(MAX_PLAYER_BOARDS),
      boardsPerRound: z.number().int().min(1).max(16),
      byeVp: z.number().min(0).max(160000).multipleOf(0.01),
    })
    .strict(),
  z
    .object({
      action: z.literal('swiss-publish'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      round: z.number().int().min(1).max(MAX_PLAYER_BOARDS),
      partial: z.boolean(),
    })
    .strict(),

  z
    .object({
      action: z.literal('rosters-import'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '匯入隊伍賽員名單'),
      csv: z.string().min(1).max(200000),
    })
    .strict(),
  z
    .object({
      action: z.literal('lineups-import'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '匯入入座名單'),
      csv: z.string().min(1).max(200000),
    })
    .strict(),
  z
    .object({
      action: z.literal('stage-archive'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('clear-results'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      confirmName: z.string().min(1).max(80),
    })
    .strict(),
  z
    .object({
      action: z.literal('results-import'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '匯入成績'),
      csv: z.string().min(1).max(200000),
    })
    .strict(),
  z
    .object({
      action: z.literal('round-times-import'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '匯入圈次時間'),
      csv: z.string().min(1).max(200000),
    })
    .strict(),
  z
    .object({
      action: z.literal('movement-plan'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      plan: z.string().min(1).max(80),
      pairMovement: z
        .object({
          groupOrder: z
            .array(z.number().int().min(1).max(MAX_PLAYER_BOARDS))
            .min(1)
            .max(MAX_PLAYER_BOARDS)
            .optional(),
          barometer: z.boolean().optional(),
          phantom: z.number().int().min(1).max(80).optional(),
          pairOrder: z.array(z.string().min(1).max(80)).min(3).max(80).optional(),
        })
        .strict()
        .optional(),
      movementFile: z.array(z.number().int().min(0).max(255)).min(707).max(20000).optional(),
      arrowSwitchRound: z.number().int().min(0).max(MAX_PLAYER_BOARDS).optional(),
      interleavedGroups: z
        .array(
          z
            .array(z.array(z.string().min(1).max(80)).min(3).max(5))
            .min(1)
            .max(10),
        )
        .min(1)
        .max(MAX_PLAYER_BOARDS / 2)
        .optional(),
      byeVp: z.number().min(0).max(160000).multipleOf(0.01).optional(),
      rounds: z.number().int().min(1).max(MAX_PLAYER_BOARDS).optional(),
      boardsPerRound: z.number().int().min(1).max(16).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('team-roster'),
      revision: z.number().int(),
      requestId: z.string().uuid(),
      reason: z.string().min(2).max(200),
      participantId: z.string(),
      players: z.array(z.string().trim().min(1).max(80)).max(30),
      captain: z.string().trim().max(80),
    })
    .strict(),
  z
    .object({
      action: z.literal('table-lineup'),
      revision: z.number().int(),
      requestId: z.string().uuid(),
      reason: z.string().min(2).max(200),
      assignmentId: z.string(),
      playerNames: z
        .object({
          N: z.string().trim().max(80),
          E: z.string().trim().max(80),
          S: z.string().trim().max(80),
          W: z.string().trim().max(80),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal('competition-settings'),
      revision: z.number().int(),
      requestId: z.string().uuid(),
      reason: z.string().min(2).max(200),
      name: z.string().trim().min(2).max(80),
      prefix: z.string().trim().max(80),
      venue: z.string().trim().max(80),
    })
    .strict(),
  z
    .object({
      action: z.literal('club-config'),
      revision: z.number().int(),
      requestId: z.string().uuid(),
      reason: z.string().min(2).max(200),
      enabled: z.boolean(),
      mode: z.enum(['pair', 'table']).optional(),
      deviceKey: z.string().max(300).optional(),
      inputRule: z.enum(['ns', 'ew', 'lower', 'higher']).optional(),
      assignmentId: z.string().optional(),
      inputPair: z.string().nullable().optional(),
      participantId: z.string().optional(),
      tokenHash: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('club-play'),
      revision: z.number().int(),
      requestId: z.string().uuid(),
      reason: z.string().min(2).max(200),
      tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
      round: z.number().int().min(1),
      confirm: z.boolean(),
      reviewVersion: z.string().max(32000).optional(),
      result: resultSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('club-complete-table'),
      revision: z.number().int(),
      requestId: z.string().uuid(),
      reason: z.string().min(2).max(200),
      assignmentId: z.string().min(1),
      round: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('club-finalize'),
      revision: z.number().int(),
      requestId: z.string().uuid(),
      reason: z.string().min(2).max(200),
      round: z.number().int().min(1),
      force: z.boolean(),
      advance: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('round-control'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      round: z.number().int().min(0).max(MAX_PLAYER_BOARDS),
      phase: z.enum(['playing', 'break']),
      publishGroups: z.array(z.number().int().positive()).max(MAX_PLAYER_BOARDS).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('round-timing'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      round: z.number().int().min(1).max(MAX_PLAYER_BOARDS),
      startAt: z.string().datetime({ offset: true }).nullable(),
      endAt: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('board-publication'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      board: z.number().int().min(1),
      published: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('split-contract'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      assignmentId: z.string().min(1).max(100),
      board: z.number().int().min(1),
      contracts: z.object({ ns: resultSchema, ew: resultSchema }).strict().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('clear-result'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '清除此副成績'),
      assignmentId: z.string().min(1).max(100),
      board: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('ruling'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '取消／恢復成績'),
      assignmentId: z.string().min(1).max(100),
      board: z.number().int().min(1),
      cancelled: z.boolean(),
      result: resultSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('penalty'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      participantId: z.string().min(1).max(100),
      amount: z.number().min(0).max(10000),
    })
    .strict(),
  z
    .object({
      action: z.literal('results'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '輸入／更正成績'),
      results: z.array(resultSchema).min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal('settings'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      status: z.enum(['live', 'review', 'finished']),
      teamMethod: z.enum(['imp', 'bam']).optional(),
      bam: bamSchema.optional(),
      maxBoardNumber: z.number().int().min(0).optional(),
      publishBoards: z.boolean().optional(),
      awardPlacesNS: z.number().int().min(0).max(32).optional(),
      awardPlacesEW: z.number().int().min(0).max(32).optional(),
      awardPlaces: z.number().int().min(0).max(32).optional(),
      audienceRefreshSeconds: z.number().int().min(15).max(120).optional(),
      danmakuDefaultEnabled: z.boolean().optional(),
      showScoreCandles: z.boolean().optional(),
      awardDescription: z.string().trim().max(2000).optional(),
      winAward: z
        .object({
          enabled: z.boolean(),
          win: z.number().min(0).max(10000),
          loss: z.number().min(0).max(10000),
          draw: z.number().min(0).max(10000),
        })
        .strict()
        .optional(),
      movementDescription: z.string().trim().max(4000).optional(),
      date: dateSchema.optional(),
      endDate: dateSchema.nullable().optional(),
      stageName: z.string().trim().min(1).max(80).optional(),
      venueOverride: z.string().trim().max(80).nullable().optional(),
      name: z.string().trim().min(2).max(80).optional(),
      prefix: z.string().trim().max(80).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('pbn'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '匯入牌型'),
      pbn: z.string().min(1).max(200000),
    })
    .strict(),
  z
    .object({
      action: z.literal('movement'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z
        .string()
        .trim()
        .max(200)
        .optional()
        .transform((value) => value || '匯入賽程編排'),
      csv: z.string().min(1).max(200000),
    })
    .strict(),
]);
export type Mutation = z.infer<typeof mutationSchema>;
export type StoredEvent = { event: BridgeEvent; requests: string[]; projection: Projection };
export type Standing = {
  group?: 'NS' | 'EW';
  id: string;
  name: string;
  players: string;
  rank: number;
  score: number | null;
  secondary: number;
  played: number;
  total: number;
  penalty?: number;
};
export type MatchScore = {
  id: string;
  round: number;
  a: string;
  b: string;
  bamA?: number;
  bamB?: number;
  impsA: number;
  impsB: number;
  marginA: number;
  marginB: number;
  split: boolean;
  completed: number;
  total: number;
  vpA: number | null;
  vpB: number | null;
};
export type PairScore = {
  ns: number | null;
  ew: number | null;
  top: number;
  provisional: boolean;
  datum?: number;
  cancelled?: boolean;
};
export type Projection = {
  byes?: { round: number; participantId: string; vp: number; awarded: boolean }[];
  standings: Standing[];
  matches: MatchScore[];
  pairScores: Record<string, PairScore>;
  received: number;
  expected: number;
};
export type PublicEvent = Omit<BridgeEvent, 'audit' | 'club' | 'boards'> & {
  clubEnabled?: boolean;
  collectionProgress?: ReturnType<typeof import('./round-progress').roundProgress>;
  boards: Omit<Board, 'deal'>[] | Board[];
  projection: Projection;
};
export const resultKey = (assignment: string, board: number) => `${assignment}:${board}`;
