import { agentRoute } from '@/lib/agent/routes';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return agentRoute('status', request, (await params).eventId);
}
