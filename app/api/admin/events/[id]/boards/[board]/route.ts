import { NextResponse } from 'next/server';
import { isDirector } from '@/lib/auth';
import { getEvent } from '@/lib/store';
import { DomainError } from '@/lib/events';
import { errorResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string; board: string }> }) {
  try {
    if (!(await isDirector())) throw new DomainError('此操作僅限裁判', 403);
    const { id, board: number } = await params;
    const { event } = await getEvent(id);
    const board = event.boards.find(b => b.number === Number(number));
    if (!board) throw new DomainError('找不到此副牌', 404);
    if (board.deal.N.length !== 13) throw new DomainError('尚未匯入牌型', 400);
    return NextResponse.json({ board }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
