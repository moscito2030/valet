import { z } from 'zod';
export const seats = ['N', 'E', 'S', 'W'] as const;
export type Seat = (typeof seats)[number];
export type Kind = 'teams' | 'pairs';
export type PairMethod = 'mp' | 'crossimp' | 'butler';
export type Trim = 'none' | 'one' | 'ten-percent';
export type Vulnerability = 'None' | 'NS' | 'EW' | 'All';
export type Participant = { id: string; name: string; players: string; captain?: string; group?: 'NS' | 'EW' };
export type CompetitionInfo = {
  id: string;
  name: string;
  prefix: string;
  date: string;
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
    board: z.number().int().min(1).max(128),
    level: z.number().int().min(0).max(7),
    strain: z.enum(['C', 'D', 'H', 'S', 'NT']),
    doubled: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    declarer: z.enum(seats),
    tricks: z.number().int().min(0).max(13),
    lead: z.string().max(4).default(''),
    miniBridge: z.boolean().optional(),
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
export type BridgeEvent = {
  // A root record holds shared competition metadata and its original scoring session.
  parentEventId?: string;
  stageName?: string;
  hasStages?: boolean;
  competition?: CompetitionInfo;
  club?: {
    enabled: boolean;
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
  gameMode?: 'bridge' | 'minibridge';
  date: string;
  venue: string;
  rounds: number;
  boardsPerRound: number;
  maxBoardNumber?: number;
  awardPlaces?: number;
  awardDescription?: string;
  movementDescription?: string;
  movementImported?: boolean;
  teamMovement?: 'interleaved';
  byeVp?: number;
  currentRound?: number;
  roundPhase?: 'playing' | 'break';
  roundTimes?: Record<number, { startAt: string; endAt: string }>;
  status: 'live' | 'finished';
  publishBoards: boolean;
  pairMethod?: PairMethod;
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
export const createSchema = z
  .object({
    firstStageName: z.string().trim().min(1).max(80).optional(),
    name: z.string().trim().min(2).max(80),
    prefix: z.string().trim().max(80).optional(),
    kind: z.enum(['teams', 'pairs']),
    gameMode: z.enum(['bridge', 'minibridge']).optional(),
    movementPlan: z.enum(['double-mitchell', 'double-mitchell-relay']).optional(),
    pairMethod: z.enum(['mp', 'crossimp', 'butler']).optional(),
    trim: z.enum(['none', 'one', 'ten-percent']).optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
        '日期不正確',
      ),
    venue: z.string().trim().max(80),
    names: z.array(z.string().trim().min(1).max(60)).min(3).max(38),
    rounds: z.number().int().min(1).max(31).optional(),
    boardsPerRound: z.number().int().min(1).max(32).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'teams' && (v.names.length > 32 || (v.rounds ?? 0) > 31 || v.movementPlan))
      ctx.addIssue({ code: 'custom', message: '隊制賽最多 32 隊、31 圈，不適用雙冠軍編排' });
    if (v.kind === 'pairs' && (v.rounds ?? 0) > 19) ctx.addIssue({ code: 'custom', message: '雙人賽最多 19 圈' });
    if (v.rounds && !v.boardsPerRound) ctx.addIssue({ code: 'custom', message: '設定圈數時請同時指定每圈牌數' });
    if (v.movementPlan && (v.names.length < 6 || v.names.length % 2 || (v.movementPlan === 'double-mitchell-relay' && v.names.length % 4))) ctx.addIssue({ code: 'custom', message: '雙冠軍需 3–19 桌完整搭檔，共牌／中繼僅適用偶數桌' });
    if (new Set(v.names).size !== v.names.length)
      ctx.addIssue({ code: 'custom', message: '名稱不可重複' });
    if (v.kind === 'pairs' && v.names.length < 4)
      ctx.addIssue({ code: 'custom', message: '雙人賽至少四對' });
    if ((v.rounds ?? 0) * (v.boardsPerRound ?? 0) > 128)
      ctx.addIssue({ code: 'custom', message: '每場最多 128 副' });
  });
export const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rosters-import'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().max(200).optional().transform(value => value || '匯入隊伍賽員名單'), csv: z.string().min(1).max(200000) }).strict(),
  z.object({ action: z.literal('lineups-import'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().max(200).optional().transform(value => value || '匯入入座名單'), csv: z.string().min(1).max(200000) }).strict(),
  z.object({ action: z.literal('clear-results'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().min(2).max(200), confirmName: z.string().min(1).max(80) }).strict(),
  z.object({ action: z.literal('results-import'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().max(200).optional().transform(value => value || '匯入成績'), csv: z.string().min(1).max(200000) }).strict(),
  z.object({ action: z.literal('round-times-import'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().max(200).optional().transform(value => value || '匯入圈次時間'), csv: z.string().min(1).max(200000) }).strict(),
  z.object({ action: z.literal('movement-plan'), revision: z.number().int().min(1), requestId: z.string().uuid(), reason: z.string().trim().min(2).max(200), plan: z.string().min(1).max(80), interleavedGroups: z.array(z.array(z.array(z.string().min(1).max(80)).min(3).max(5)).min(1).max(10)).min(1).max(15).optional(), byeVp: z.number().min(0).max(20).multipleOf(0.01).optional(), rounds: z.number().int().min(1).max(31).optional(), boardsPerRound: z.number().int().min(1).max(32).optional() }).strict(),
  z.object({ action: z.literal('team-roster'), revision: z.number().int(), requestId: z.string().uuid(), reason: z.string().min(2).max(200), participantId: z.string(), players: z.array(z.string().trim().min(1).max(80)).max(30), captain: z.string().trim().max(80) }).strict(),
  z.object({ action: z.literal('table-lineup'), revision: z.number().int(), requestId: z.string().uuid(), reason: z.string().min(2).max(200), assignmentId: z.string(), playerNames: z.object({ N: z.string().trim().max(80), E: z.string().trim().max(80), S: z.string().trim().max(80), W: z.string().trim().max(80) }).strict() }).strict(),
  z.object({ action: z.literal('competition-settings'), revision: z.number().int(), requestId: z.string().uuid(), reason: z.string().min(2).max(200), name: z.string().trim().min(2).max(80), prefix: z.string().trim().max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, '日期不正確'), venue: z.string().trim().max(80) }).strict(),
  z.object({ action: z.literal('club-config'), revision: z.number().int(), requestId: z.string().uuid(), reason: z.string().min(2).max(200), enabled: z.boolean(), inputRule: z.enum(['ns', 'ew', 'lower', 'higher']).optional(), assignmentId: z.string().optional(), inputPair: z.string().nullable().optional(), participantId: z.string().optional(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict(),
  z.object({ action: z.literal('club-play'), revision: z.number().int(), requestId: z.string().uuid(), reason: z.string().min(2).max(200), tokenHash: z.string().regex(/^[a-f0-9]{64}$/), round: z.number().int().min(1), confirm: z.boolean(), reviewVersion: z.string().max(32000).optional(), result: resultSchema.optional() }).strict(),
  z.object({ action: z.literal('club-finalize'), revision: z.number().int(), requestId: z.string().uuid(), reason: z.string().min(2).max(200), round: z.number().int().min(1), force: z.boolean() }).strict(),
  z
    .object({
      action: z.literal('round-control'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      round: z.number().int().min(0).max(31),
      phase: z.enum(['playing', 'break']),
    })
    .strict(),
  z
    .object({
      action: z.literal('round-timing'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      round: z.number().int().min(1).max(31),
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
      board: z.number().int().min(1).max(128),
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
      board: z.number().int().min(1).max(128),
      contracts: z.object({ ns: resultSchema, ew: resultSchema }).strict().nullable(),
    }).strict(),
  z.object({
      action: z.literal('ruling'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().max(200).optional().transform(value => value || '取消／恢復成績'),
      assignmentId: z.string().min(1).max(100),
      board: z.number().int().min(1).max(128),
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
      reason: z.string().trim().max(200).optional().transform(value => value || '輸入／更正成績'),
      results: z.array(resultSchema).min(1).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal('settings'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().min(2).max(200),
      status: z.enum(['live', 'finished']),
      maxBoardNumber: z.number().int().min(0).max(128).optional(),
      publishBoards: z.boolean().optional(),
      awardPlaces: z.number().int().min(0).max(32).optional(),
      awardDescription: z.string().trim().max(2000).optional(),
      movementDescription: z.string().trim().max(4000).optional(),
      stageName: z.string().trim().min(1).max(80).optional(),
      name: z.string().trim().min(2).max(80).optional(),
      prefix: z.string().trim().max(80).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('pbn'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().max(200).optional().transform(value => value || '匯入牌型'),
      pbn: z.string().min(1).max(200000),
    })
    .strict(),
  z
    .object({
      action: z.literal('movement'),
      revision: z.number().int().min(1),
      requestId: z.string().uuid(),
      reason: z.string().trim().max(200).optional().transform(value => value || '匯入賽程編排'),
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
