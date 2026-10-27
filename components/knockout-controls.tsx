'use client';
import type { BridgeEvent } from '@/lib/model';
import type { KnockoutNode } from '@/lib/knockout-schema';
import { currentKnockoutScore } from '@/lib/knockout';

export function KnockoutControls({
  event,
  node,
  busy,
  save,
}: {
  event: BridgeEvent;
  node: KnockoutNode;
  busy: boolean;
  save: (p: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const p = event.knockout?.published[node.id];
  if (!p?.b || event.knockout?.decisions[node.id] || event.status === 'finished') return null;
  const names = [p.a, p.b].map(
    (id) => event.participants.find((team) => team.id === id)?.name ?? id,
  );
  const score = currentKnockoutScore(event, node);
  const adjustment = event.knockout?.adjustments?.[node.id];
  const submit = (action: string) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void save({
      action,
      nodeId: node.id,
      reason: String(form.get('reason')),
      ...(action === 'knockout-adjust'
        ? { a: Number(form.get('a')), b: Number(form.get('b')) }
        : {}),
      ...(action === 'knockout-overtime' ? { boards: Number(form.get('boards')) } : {}),
      ...(action === 'knockout-forfeit'
        ? { loser: String(form.get('loser')), withdraw: form.get('withdraw') === 'on' }
        : {}),
    });
  };
  const reason = (
    <label className="field">
      原因
      <input name="reason" required minLength={2} maxLength={200} />
    </label>
  );
  return (
    <section className="knockout-controls" aria-label={`${node.name} 裁判操作`}>
      {event.teamMethod !== 'bam' && (
        <>
          <form onSubmit={submit('knockout-adjust')}>
            <h5>對局 IMP 調整</h5>
            <div className="form-grid">
              {(['a', 'b'] as const).map((side, i) => (
                <label className="field" key={side}>
                  {names[i]} 調整 IMP
                  <input
                    name={side}
                    type="number"
                    required
                    min={-10000}
                    max={10000}
                    step="0.01"
                    defaultValue={adjustment?.[side] ?? 0}
                  />
                </label>
              ))}
            </div>
            <p className="footnote">
              正數加分、負數扣分，雙方 IMP 淨差同步反向調整；儲存時替換原調整。
            </p>
            {reason}
            <button className="button subtle" disabled={busy}>
              儲存 IMP 調整
            </button>
          </form>
          <form onSubmit={submit('knockout-overtime')}>
            <h5>平手加賽</h5>
            <label className="field">
              加賽牌數
              <input name="boards" type="number" required min={1} max={16} defaultValue={1} />
            </label>
            <p className="footnote">
              累積 IMP 平手且已結算時可追加一節；後續對局延後，原有成績保留。
            </p>
            {reason}
            <button className="button subtle" disabled={busy || !score.complete || !score.tied}>
              追加加賽
            </button>
          </form>
        </>
      )}
      <form onSubmit={submit('knockout-forfeit')}>
        <h5>棄權／退賽決勝</h5>
        <label className="field">
          棄權隊伍
          <select name="loser" required defaultValue="">
            <option value="" disabled>
              請選擇
            </option>
            <option value={p.a}>{names[0]}</option>
            <option value={p.b}>{names[1]}</option>
          </select>
        </label>
        <label>
          <input type="checkbox" name="withdraw" /> 同時退賽，不參加後續名次賽
        </label>
        <p className="footnote">
          保留已打牌局及本對局指定的名次；未打牌局不補造結果。僅本場棄權者仍可參加後續名次賽。
        </p>
        {reason}
        <button className="button subtle" disabled={busy}>
          確認棄權決勝
        </button>
      </form>
    </section>
  );
}
