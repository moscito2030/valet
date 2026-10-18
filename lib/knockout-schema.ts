import { z } from 'zod';
export const knockoutSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('team'), id: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal('winner'), id: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal('loser'), id: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal('bye') }).strict(),
]);
export const knockoutNodeSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    name: z.string().trim().min(1).max(80),
    a: knockoutSourceSchema,
    b: knockoutSourceSchema,
    startRound: z.number().int().min(1).max(1024),
    rounds: z.number().int().min(1).max(1024),
    boardsPerRound: z.number().int().min(1).max(16),
    table: z.number().int().min(1).max(32),
    winnerPlace: z.number().int().min(1).max(32).optional(),
    loserPlace: z.number().int().min(1).max(32).optional(),
  })
  .strict();
export type KnockoutSource = z.infer<typeof knockoutSourceSchema>;
export type KnockoutNode = z.infer<typeof knockoutNodeSchema>;
export type Knockout = {
  nodes: KnockoutNode[];
  published: Record<string, { a: string; b: string | null }>;
  decisions: Record<string, { winner: string; loser?: string; basis?: string; reason?: string }>;
};
