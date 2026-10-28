import { isImpKnockout } from '@/lib/knockout-status';
import { AdminEvent } from '../scoreboard-shared';

type Props = {
  busy: boolean;
  event: AdminEvent;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
};
export function PenaltyPanel({ busy, event, save }: Props) {
  if (event.knockout || isImpKnockout(event)) return <p>淘汰賽請至「淘汰賽」分頁選擇對局，由裁判調整 IMP 或處理棄權。</p>;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        await save({
          action: 'penalty',
          participantId: form.get('participantId'),
          amount: Number(form.get('amount')),
          reason: form.get('reason'),
        });
      }}
    >
      <h4>判罰調整</h4>
      <p>
        設定該參賽者的累計扣分（取代既有值，非追加）；輸入 0 可撤銷。單位：
        {event.kind === 'teams'
          ? 'VP'
          : (event.pairMethod ?? 'mp') === 'mp'
            ? '總百分點'
            : '總 IMP'}
        。不改原始合約分。
      </p>
      <label className="field">
        處罰對象
        <select name="participantId">
          {event.participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · 目前扣分 {event.penalties?.[p.id] ?? 0}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        判罰扣分
        <input
          name="amount"
          type="number"
          min={0}
          max={10000}
          step="0.01"
          required
          defaultValue={0}
        />
      </label>
      <label className="field">
        裁定原因
        <input
          name="reason"
          minLength={2}
          maxLength={200}
          required
          placeholder="例如：遲到、程序違規或撤銷處罰"
        />
      </label>
      <button className="button primary" disabled={busy || event.status === 'finished'}>
        儲存判罰調整
      </button>
    </form>
  );
}
