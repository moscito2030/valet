import { agentRoute } from '@/lib/agent/routes';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return agentRoute('mutations', request, (await params).eventId);
}
