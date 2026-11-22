'use client';
import { useState } from 'react';
import type { BridgeEvent, PairMethod, Trim } from '@/lib/model';

const labels: Record<PairMethod, string> = { mp: 'MP 百分比', crossimp: 'CrossIMP', butler: 'ButlerIMP' };

export function PairScoringSettings({
  event,
  busy,
  save,
}: {
  event: Pick<BridgeEvent, 'kind' | 'pairMethod' | 'trim' | 'neuberg' | 'adjustedSession' | 'results' | 'status'>;
  busy: boolean;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const method = (event.pairMethod ?? 'mp') as PairMethod;
  const [selected, setSelected] = useState<PairMethod>(method);
  if (event.kind !== 'pairs') return null;
  const locked = Object.keys(event.results).length > 0 || event.status === 'finished';
  return (
    <form
      className="setting-row event-description-settings"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const pairMethod = String(form.get('pairMethod')) as PairMethod;
        void save({
          action: 'settings',
          status: event.status,
          pairMethod,
          trim: pairMethod === 'mp' ? 'none' : (String(form.get('trim')) as Trim),
          adjustedSession: form.get('adjustedSession') === 'true',
          neuberg: pairMethod === 'mp' && form.get('neuberg') === 'true',
          reason: '設定雙人計分方式',
        });
      }}
    >
      <h4>雙人計分</h4>
      <p>{labels[method]}</p>
      <label className="field">
        計分模式
        <select name="pairMethod" value={selected} disabled={locked || busy} onChange={(e) => setSelected(e.target.value as PairMethod)}>
          <option value="mp">MP 百分比</option>
          <option value="crossimp">CrossIMP</option>
          <option value="butler">ButlerIMP</option>
        </select>
      </label>
      <label className="field">
        去頭去尾
        <select name="trim" defaultValue={event.trim ?? 'none'} disabled={locked || busy || selected === 'mp'}>
          <option value="none">不去除</option>
          <option value="one">最高、最低各去一筆</option>
          <option value="ten-percent">最高、最低各去 10%</option>
        </select>
      </label>
      {selected === 'mp' && (
        <label className="field">
          Neuberg 修正
          <select name="neuberg" defaultValue={event.neuberg ? 'true' : 'false'} disabled={locked || busy}>
            <option value="false">關閉</option>
            <option value="true">開啟</option>
          </select>
        </label>
      )}
      <label className="field">
        調整分依賽段成績修正（12C2(c)）
        <select name="adjustedSession" defaultValue={String(event.adjustedSession !== false)} disabled={locked || busy}>
          <option value="true">開啟</option>
          <option value="false">關閉</option>
        </select>
      </label>
      {locked ? <p className="footnote">已有成績，計分規則已鎖定。</p> : <button className="button subtle" disabled={busy}>儲存雙人計分</button>}
    </form>
  );
}
