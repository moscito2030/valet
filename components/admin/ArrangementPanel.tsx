import { ClearResults } from '../clear-results';
import { AdminEvent } from '../scoreboard-shared';

type Props = {
  busy: boolean;
  event: AdminEvent;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
};
export function ArrangementPanel({ busy, event, save }: Props) {
  if (event.status === 'finished')
    return <p className="footnote">賽段已結束，成績已定案，不可清除。</p>;
  return (
    <ClearResults
      name={event.stageName || event.name}
      count={Object.keys(event.results).length}
      busy={busy}
      save={save}
    />
  );
}
