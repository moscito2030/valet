import { AdminEvent } from '../scoreboard-shared';
import { allRoundsComplete } from '@/lib/round-progress';
import { RoundStateFields } from './round-state-fields';
type Props = {
  busy: boolean;
  event: AdminEvent;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
};
export function RoundControlPanel({ busy, event, save }: Props) {
  return (
    <>
      <form
        className="round-settings-form"
        key={`current-${event.currentRound}-${event.roundPhase}`}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void save({
            action: 'round-control',
            round: Number(form.get('round')),
            phase: String(form.get('phase')),
            reason: '裁判指定目前圈數與比賽進度',
          });
        }}
      >
        <h4>目前打到哪一圈</h4>
        <RoundStateFields key={event.revision} event={event} />
        <p className="footnote">
          圈數會隨收分進度往前更新；該圈收齊後進入圈間休息，全部圈次完成後進入成績覆核中。
        </p>
        <button className="button primary" disabled={busy || event.status === 'finished'}>
          儲存目前圈數
        </button>
        {event.status === 'finished' && (
          <p className="footnote">賽段已結束，成績已定案，不可調整目前圈數。</p>
        )}
      </form>
      <div className="setting-row">
        <div>
          <strong>賽段狀態 · {event.status === 'finished' ? '已結束' : event.status === 'review' || allRoundsComplete(event) ? '成績覆核中' : '進行中'}</strong>
          <p>{event.status === 'finished' ? '成績已定案，使用快取呈現，不再接受更正。' : '全部圈次完成後進入成績覆核，選手可向裁判提出更正。確認結束後不可重新開放。'}</p>
        </div>
        <button
          type="button"
          disabled={busy || !event.canDirect || event.status === 'finished' || !allRoundsComplete(event)}
          className="button subtle"
          onClick={() =>
            save({
              action: 'settings',
              status: 'finished',
              reason: '完成覆核並結束賽段',
            })
          }
        >
          {event.status === 'finished' ? '已定案' : '完成覆核並結束賽段'}
        </button>
      </div>
    </>
  );
}
