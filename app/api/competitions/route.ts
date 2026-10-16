import { NextResponse } from 'next/server';
import { listEventIndex } from '@/lib/store';
import { competitionCatalog } from '@/lib/competitions';
import { errorResponse } from '@/lib/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return NextResponse.json({ competitions: competitionCatalog(await listEventIndex()) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (e) { return errorResponse(e); }
}
