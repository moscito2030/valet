'use client';
import { useState } from 'react';
import type { BridgeEvent } from '@/lib/model';
import { defaultBam, teamScoringLabel, type TeamScoring } from '@/lib/team-method';
export function teamScoringPayload(form: FormData) {
  const teamMethod = form.get('teamMethod') === 'bam' ? ('bam' as const) : ('imp' as const);
  return {
    teamMethod,
    ...(teamMethod === 'bam'
      ? {
          bam: {
            win: Number(form.get('bamWin')),
            draw: Number(form.get('bamDraw')),
            loss: Number(form.get('bamLoss')),
          },
        }
      : {}),
  };
}
export function TeamScoringFields({
  event = {},
  disabled = false,
}: {
  event?: TeamScoring;
  disabled?: boolean;
}) {
  const [method, setMethod] = useState(event.teamMethod ?? 'imp');
  const scale = event.bam ?? defaultBam;
  return (
    <>
      <label className="field">
        隊制計分方式
        <select
          name="teamMethod"
          value={method}
          disabled={disabled}
          onChange={(e) => setMethod(e.target.value as 'imp' | 'bam')}
        >
          <option value="imp">IMP／VP</option>
          <option value="bam">Board-A-Match</option>
        </select>
      </label>
      {method === 'bam' && (
        <>
          <div className="form-grid">
            {(
              [
                ['Win', '勝', scale.win],
                ['Draw', '和', scale.draw],
                ['Loss', '負', scale.loss],
              ] as const
            ).map(([key, label, value]) => (
              <label className="field" key={key}>
                每牌{label}方 VP
                <input
                  name={'bam' + key}
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  required
                  defaultValue={value}
                  disabled={disabled}
                />
              </label>
            ))}
          </div>
          <p className="footnote">
            比較兩室原始分，每牌 VP 直接加總；取消牌不給分，不套用 WBF 換算表。
          </p>
        </>
      )}
    </>
  );
}
export function TeamScoringSettings({
  event,
  busy,
  save,
}: {
  event: Pick<BridgeEvent, 'kind' | 'teamMethod' | 'bam' | 'results' | 'swiss' | 'status'>;
  busy: boolean;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  if (event.kind !== 'teams') return null;
  const locked =
    Object.keys(event.results).length > 0 ||
    !!event.swiss?.publications.length ||
    event.status === 'finished';
  return (
    <form
      className="setting-row event-description-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          action: 'settings',
          status: event.status,
          ...teamScoringPayload(new FormData(e.currentTarget)),
          reason: '設定隊制計分方式',
        });
      }}
    >
      <h4>隊制計分</h4>
      <p>{teamScoringLabel(event)}</p>
      <TeamScoringFields
        key={JSON.stringify([event.teamMethod, event.bam])}
        event={event}
        disabled={locked || busy}
      />
      {locked ? (
        <p className="footnote">已有成績或已公布 Swiss 對戰，計分規則已鎖定。</p>
      ) : (
        <button className="button subtle" disabled={busy}>
          儲存隊制計分
        </button>
      )}
    </form>
  );
}
