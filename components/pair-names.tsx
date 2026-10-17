'use client';
import { useState } from 'react';
import type { Participant } from '@/lib/model';

export function PairNames({ participants, busy, save }: {
  participants: Participant[];
  busy: boolean;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [selected, setSelected] = useState(participants[0]?.id ?? '');
  const pair = participants.find(p => p.id === selected);
  return <section className="import-export-section">
    <h4>搭檔姓名／名稱</h4>
    <p>修改這對搭檔的顯示名稱；搭檔編號、賽程、成績與收分連結保留。已結束的賽段也可以更正名稱。</p>
    <label className="field">選擇搭檔<select value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}>
      {participants.map(p => <option key={p.id} value={p.id}>{p.id.toUpperCase()} · {p.name}</option>)}
    </select></label>
    {pair && <form key={`${pair.id}:${pair.name}`} onSubmit={e => {
      e.preventDefault();
      void save({ action: 'pair-name', participantId: pair.id, name: String(new FormData(e.currentTarget).get('name')), reason: '更正雙人賽搭檔名稱' });
    }}>
      <label className="field">搭檔姓名／名稱<input name="name" required maxLength={60} defaultValue={pair.name} disabled={busy} /></label>
      <button className="button subtle" disabled={busy}>儲存搭檔名稱</button>
    </form>}
  </section>;
}
