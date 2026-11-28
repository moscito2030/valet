import { cookies } from 'next/headers';
export const dynamic = 'force-dynamic';
const headers: Record<string, HeadersInit> = {
  standings: { 'Cache-Control': 'public, max-age=31536000, s-maxage=86400, immutable' },
  progress: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=10' },
  admin: { 'Cache-Control': 'private, no-cache', Vary: 'Cookie' },
  tablet: { 'Cache-Control': 'no-store' },
};
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; tag: string }> }) {
  const { kind, tag } = await params;
  const signedIn = (await cookies()).has('bridge_admin');
  return Response.json({ kind, tag, signedIn, generatedAt: new Date().toISOString() }, { headers: headers[kind] });
}
