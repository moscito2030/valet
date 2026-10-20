'use client';
import { useState } from 'react';
import type { BridgeEvent } from '@/lib/model';
export function ParticipantsSetup({
  event,
  busy,
  save,
}: {
  event: BridgeEvent;
  busy: boolean;
  save: (p: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [mode, setMode] = useState<'single' | 'double'>(
    event.rankingMode ?? (event.participants.some((p) => p.group) ? 'double' : 'single'),
  );
  const [names, setNames] = useState(event.participants.map((p) => p.name).join('\n'));
  const [ns, setNs] = useState(
    event.participants
      .filter((p) => p.group === 'NS')
      .map((p) => p.name)
      .join('\n'),
  );
  const [ew, setEw] = useState(
    event.participants
      .filter((p) => p.group === 'EW')
      .map((p) => p.name)
      .join('\n'),
  );
  const [count, setCount] = useState(''),
    [error, setError] = useState('');
  const locked =
    event.status !== 'live' ||
    !!event.assignments.length ||
    !!Object.keys(event.results).length ||
    !!event.knockout ||
    !!event.swiss ||
    !!Object.keys(event.club?.tokens ?? {}).length;
  if (locked) return null;
  const lines = (s: string) =>
    s
      .split(/\r?\n/)
      .map((n) => n.trim())
      .filter(Boolean);
  const grouped = event.kind === 'pairs' && mode === 'double';
  const entries = grouped ? [...lines(ns), ...lines(ew)] : lines(names);
  return (
    <section className="import-export-section">
      <h4>參賽名單</h4>
      <p>
        {event.participants.length
          ? `目前 ${event.participants.length} ${event.kind === 'teams' ? '隊' : '對'}`
          : '尚未設定名單。請先設定名單，再安排賽程。'}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (grouped && lines(ns).length !== lines(ew).length) {
            setError('NS 與 EW 組需有相同搭檔數');
            return;
          }
          await save({
            action: 'participants-setup',
            names: entries,
            ...(event.kind === 'pairs' ? { rankingMode: mode } : {}),
            reason: '設定賽段參賽名單',
          });
        }}
      >
        {event.kind === 'pairs' && (
          <label className="field">
            排名方式
            <select
              value={mode}
              onChange={(e) => {
                const next = e.target.value as 'single' | 'double';
                if (next === 'double') {
                  const all = lines(names);
                  setNs(all.slice(0, Math.ceil(all.length / 2)).join('\n'));
                  setEw(all.slice(Math.ceil(all.length / 2)).join('\n'));
                } else setNames([...lines(ns), ...lines(ew)].join('\n'));
                setMode(next);
              }}
            >
              <option value="single">Single Winner</option>
              <option value="double">Double Winner</option>
            </select>
          </label>
        )}
        <label className="field">
          {event.kind === 'teams' ? '隊數' : '搭檔數'}（選填，可先產生暫名）
          <input
            type="number"
            min={event.kind === 'teams' ? 2 : grouped ? 6 : 4}
            max={event.kind === 'teams' ? 32 : 80}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            const n = Number(count);
            if (
              !Number.isInteger(n) ||
              n < (event.kind === 'teams' ? 2 : grouped ? 6 : 4) ||
              n > (event.kind === 'teams' ? 32 : 80) ||
              (grouped && n % 2)
            ) {
              setError('請填有效人數；Double Winner 須為偶數且至少六對');
              return;
            }
            setError('');
            const all = Array.from(
              { length: n },
              (_, i) => (event.kind === 'teams' ? '隊伍 ' : '搭檔 ') + (i + 1),
            );
            if (grouped) {
              setNs(all.slice(0, n / 2).join('\n'));
              setEw(all.slice(n / 2).join('\n'));
            } else setNames(all.join('\n'));
          }}
        >
          產生暫名草稿
        </button>
        {grouped ? (
          <div className="form-grid">
            <label className="field">
              NS 搭檔（一行一對）
              <textarea value={ns} onChange={(e) => setNs(e.target.value)} rows={6} />
            </label>
            <label className="field">
              EW 搭檔（一行一對）
              <textarea value={ew} onChange={(e) => setEw(e.target.value)} rows={6} />
            </label>
          </div>
        ) : (
          <label className="field">
            {event.kind === 'teams' ? '隊伍名稱' : '搭檔名稱'}（一行一個，可直接貼上名單）
            <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={6} />
          </label>
        )}
        <p className="footnote">
          草稿共 {entries.length} {event.kind === 'teams' ? '隊' : '對'}
          。儲存後再選擇賽程編排；整份留空可保留為待設定賽段。
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          儲存參賽名單
        </button>
      </form>
    </section>
  );
}
