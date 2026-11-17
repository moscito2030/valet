import Scoreboard from '@/components/event-scoreboard';
import CompetitionHub from '@/components/competition-hub';
import { redirect } from 'next/navigation';
import { competitionRedirect } from '@/lib/store';
export default async function Page({ searchParams }: { searchParams: Promise<{ event?: string; competition?: string }> }) {
  const params = await searchParams;
  if (!params.event && params.competition) {
    const target = await competitionRedirect(params.competition);
    if (target) redirect(`/?competition=${encodeURIComponent(target)}`);
  }
  return params.event ? <Scoreboard /> : <CompetitionHub competitionId={params.competition} />;
}
