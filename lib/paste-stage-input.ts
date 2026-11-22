import { z } from 'zod';

export const pasteStageItems = {
  setup: '設定／移位',
  roster: '名單',
  boards: '牌',
  results: '成績',
} as const;

export type Include = Record<keyof typeof pasteStageItems, boolean>;

const revision = z.number().int().positive();
export const pasteStageSchema = z.object({
  sourceId: z.string(),
  sourceRevision: revision,
  name: z.string().trim().min(1).max(80),
  include: z.object({
    setup: z.boolean(),
    roster: z.boolean(),
    boards: z.boolean(),
    results: z.boolean(),
  }).strict(),
  revision,
}).strict().refine(({ include }) =>
  !include.results || (include.setup && include.roster && include.boards),
  { message: '帶入成績須同時帶入設定／移位、名單與牌' },
);
