import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mutateEvent } from '@/lib/store';
import { getAccessibleEvent as getEvent } from '@/lib/event-access';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
import { DomainError } from '@/lib/domain-error';
import { resultSchema } from '@/lib/model';
import { clubView } from '@/lib/club-view';
import { isStageRevisionConflict, resultUpdatedAt, staleClubResult } from '@/lib/club-submit';
export const dynamic = 'force-dynamic';
const bodySchema = z.object({
  requestId: z.string().uuid(),
  round: z.number().int().min(1),
  confirm: z.boolean(),
  reviewVersion: z.string().max(32000).optional(),
  baseUpdatedAt: z.string().max(40).optional(),
  result: resultSchema.optional(),
}).strict();
function hash(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new DomainError('請使用裁判提供的專屬連結', 401);
  return createHash('sha256').update(token).digest('hex');
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const tokenHash = hash(request);
    const { event } = await getEvent((await params).id);
    const pair = Object.entries(event.club?.tokens ?? {}).find(([, h]) => h === tokenHash)?.[0];
    if (!event.club?.enabled || !pair) throw new DomainError('連結已失效或收分模式未開啟', 403);
    return NextResponse.json(clubView(event, pair), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return errorResponse(e); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const tokenHash = hash(request);
    const body = bodySchema.parse(await readJson(request));
    const id = (await params).id;
    // Retry only when the stage revision moved and this score cell is unchanged.
    // Settled tables, closed rounds, and a cell edited since the phone loaded it are not retryable.
    let seen: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { event } = await getEvent(id);
      const current = resultUpdatedAt(event, body.result);
      const base = body.baseUpdatedAt ?? (seen === undefined ? undefined : seen);
      if (staleClubResult(current, base))
        throw new DomainError('本桌成績已更新，請重新檢查後再提交', 409);
      if (body.result) seen ??= current;
      try {
        const { baseUpdatedAt: _base, ...command } = body;
        await mutateEvent(id, { ...command, action: 'club-play', tokenHash, revision: event.revision, reason: body.confirm ? '搭檔確認本圈' : '搭檔輸入／更正' });
        return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (e) {
        if (!isStageRevisionConflict(e) || attempt === 4) throw e;
        await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 35)));
      }
    }
    throw new DomainError('請重試', 409);
  } catch (e) { return errorResponse(e); }
}
