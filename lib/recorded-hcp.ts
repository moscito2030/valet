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
