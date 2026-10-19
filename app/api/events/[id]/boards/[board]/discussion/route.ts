import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isDirector } from '@/lib/auth';
import { getAccessibleEvent } from '@/lib/event-access';
import { checkOrigin, errorResponse, readJson } from '@/lib/http';
import { DomainError } from '@/lib/domain-error';
import { discussionStore } from '@/lib/discussion-store';
import {
  moderateComment,
  addComment,
  commentSchema,
  commentView,
  consumeLimit,
  discussionPublished,
  moderationSchema,
  type Discussion,
  type LimitState,
} from '@/lib/discussion';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; board: string }> };
const empty: Discussion = { comments: [] };
const json = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
function hash(s: string) {
  if (!process.env.SESSION_SECRET) throw new DomainError('留言功能尚未設定', 503);
  return createHmac('sha256', process.env.SESSION_SECRET).update(s).digest('hex');
}
async function identity() {
  const value = (await cookies()).get('valet_discussion')?.value;
  const token = value && /^[a-f0-9]{48}$/.test(value) ? value : randomBytes(24).toString('hex');
  return { token, author: hash('author:' + token) };
}
async function target(context: Context) {
  const { id, board } = await context.params;
  const n = Number(board);
  if (!Number.isSafeInteger(n) || n < 1) throw new DomainError('牌號錯誤', 404);
  const { event } = await getAccessibleEvent(id);
  if (!event.boards.some((b) => b.number === n)) throw new DomainError('找不到牌局', 404);
  return { key: `board:${id}:${n}`, published: discussionPublished(event, n) };
}
export async function GET(_: Request, context: Context) {
  try {
    const { key, published } = await target(context);
    const store = discussionStore();
    const director = await isDirector();
    const { author } = await identity();
    const [d, global] = await Promise.all([
      store.read(key, empty),
      store.read('global', { closed: false }),
    ]);
    return json({
      published,
      director,
      globalClosed: global.closed,
      ...commentView(published ? d : { ...d, comments: [] }, author, director),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const store = discussionStore();
    const { token, author } = await identity();
    // Only trust Vercel's overwritten client-IP header in production, never arbitrary forwarded headers.
    const ip = process.env.VERCEL
      ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()
      : 'local';
    if (!ip) throw new DomainError('無法驗證留言來源', 403);
    await store.update<Partial<LimitState>>('limit:ip:' + hash(ip), {}, (s) =>
      consumeLimit(s, Date.now(), 60, 300),
    );
    await store.update<Partial<LimitState>>('limit:author:' + author, {}, (s) =>
      consumeLimit(s, Date.now(), 5, 30),
    );
    const { key, published } = await target(context);
    if (!published) throw new DomainError('牌局尚未公開，無法留言', 403);
    const [global, blocked] = await Promise.all([
      store.read('global', { closed: false }),
      store.read('block:' + author, { blocked: false }),
    ]);
    if (global.closed || blocked.blocked) throw new DomainError('目前無法發表留言', 403);
    const data = commentSchema.parse(await readJson(request));
    const comment = { ...data, id: randomUUID(), author, createdAt: new Date().toISOString() };
    await store.update(key, empty, (d) => addComment(d, comment));
    const response = json({ ok: true });
    response.cookies.set('valet_discussion', token, {
      httpOnly: true,
      secure: !!process.env.VERCEL,
      sameSite: 'lax',
      path: '/',
      maxAge: 31536000,
    });
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const director = await isDirector();
    const command = moderationSchema.parse(await readJson(request));
    if (command.action !== 'delete' && !director) throw new DomainError('此操作需要裁判權限', 403);
    const { key } = await target(context);
    const store = discussionStore();
    const { author } = await identity();
    if (command.action === 'global') {
      await store.update('global', { closed: false }, () => ({ closed: command.closed }));
    } else if (command.action === 'block') {
      const d = await store.read(key, empty);
      const c = d.comments.find((c) => c.id === command.id);
      if (!c) throw new DomainError('找不到留言', 404);
      await store.update('block:' + c.author, { blocked: false }, () => ({
        blocked: command.blocked,
      }));
    } else await store.update(key, empty, (d) => moderateComment(d, command, author, director));
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
