import { z } from 'zod';
export const recordedHcpSchema = z.object({
  N: z.number().int().min(0).max(37).optional(),
  E: z.number().int().min(0).max(37).optional(),
  S: z.number().int().min(0).max(37).optional(),
  W: z.number().int().min(0).max(37).optional(),
}).strict().refine(h => {
  const values = Object.values(h).filter((v): v is number => v !== undefined);
  const sum = values.reduce((a, b) => a + b, 0);
  return sum <= 40 && (values.length < 4 || sum === 40);
}, '大牌點合計不可超過 40；四家填完時必須合計 40');
export type RecordedHcp = z.infer<typeof recordedHcpSchema>;
export function hcpDeclarer(h: RecordedHcp, dealer: 'N'|'E'|'S'|'W') {
  if ([h.N,h.E,h.S,h.W].some(v => v === undefined)) return undefined;
  if (h.N! + h.S! === 20) return null;
  const side = h.N! + h.S! > 20 ? 'NS' : 'EW';
  const seats = ['N','E','S','W'] as const;
  const start = seats.indexOf(dealer);
  return [...seats.slice(start), ...seats.slice(0,start)].filter(s => side.includes(s)).sort((a,b) => h[b]! - h[a]!)[0];
}

export function dealHcp(deal?: Record<'N'|'E'|'S'|'W', string[]>): RecordedHcp | undefined {
  const seats = ['N','E','S','W'] as const;
  if (!deal || seats.some(s => deal[s]?.length !== 13) || new Set(seats.flatMap(s => deal[s])).size !== 52) return undefined;
  return Object.fromEntries(seats.map(s => [s, deal[s].reduce((sum, card) => sum + ({A:4,K:3,Q:2,J:1}[card.slice(1)] ?? 0), 0)]));
}
export function hcpMismatches(h: RecordedHcp, expected?: RecordedHcp) {
  return (['N','E','S','W'] as const).filter(s => h[s] !== undefined && expected?.[s] !== undefined && h[s] !== expected[s]);
}
