import r9 from './r9.json';
import r19 from './r19.json';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  return Response.json(size === 'r19' ? r19 : r9, { headers: { 'Cache-Control': 'public, max-age=31536000, s-maxage=86400, immutable' } });
}
