import { ClearResults } from '../clear-results';
import { AdminEvent } from '../scoreboard-shared';

type Props = {
  busy: boolean;
  event: AdminEvent;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
};
export function ArrangementPanel({ busy, event, save }: Props) {
  return (
    <ClearResults
      name={event.stageName || event.name}
      count={Object.keys(event.results).length}
      busy={busy}
      save={save}
    />
  );
}
