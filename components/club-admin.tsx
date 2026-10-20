'use client';
import { Modal } from './event-dialogs';
import { TableScoreReview } from './table-score-review';
import { roundLabel } from '@/lib/team-movement';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { AdminEvent } from './scoreboard-shared';
import { clubRoles, clubAccepted } from '@/lib/club-confirmation';
import { tableDevices, tableDeviceLabel } from '@/lib/table-device';
import { knockoutRoundReady } from '@/lib/knockout';
import { swissRoundComplete } from '@/lib/swiss';

export function ClubAdmin({
  event,
  reload,
}: {
  event: AdminEvent;
  reload: () => Promise<unknown>;
}) {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const reviewAssignment = event.assignments.find((a) => a.id === reviewId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState('');
  const [qr, setQr] = useState('');
  const [pair, setPair] = useState('');
  const [reason, setReason] = useState('本圈收分完成');
  const [base, setBase] = useState('');
  const [settingsRound, setSettingsRound] = useState(event.currentRound || 1);
  const [mode, setMode] = useState<'pair' | 'table'>(
    event.club?.mode ?? (event.kind === 'teams' ? 'table' : 'pair'),
  );
  const tableMode = (event.club?.enabled ? event.club.mode : mode) === 'table';
  const devices = tableDevices(event);
  useEffect(() => {
    setBase(location.origin);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      void reload().catch((e) => setError((e as Error).message));
    }, 10000);
    return () => clearInterval(timer);
  }, [reload]);
  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/club/${event.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, revision: event.revision }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.path) {
        const url = new URL(base);
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('請填寫 http 或 https 網址');
        const full = url.origin + result.path;
        setLink(full);
        setPair(
          body.deviceKey
            ? (devices.find((d) => d.key === body.deviceKey)?.label ?? '桌次')
            : String(body.pair),
        );
        setQr(await QRCode.toDataURL(full, { width: 280, margin: 2, errorCorrectionLevel: 'M' }));
      }
      setNotice('已儲存。');
      await reload();
    } catch (e) {
      setError((e as Error).message);
      await reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  const round = event.currentRound ?? 0;
  const assignments = event.assignments.filter((a) => a.round === round);
  const finalized = event.club?.finalized.includes(round);
  if (!event.participants.length || !event.assignments.length) return <p>請先在「賽程與牌局管理」完成參賽名單及編排，再設定圈次與裝置收分。</p>;
  return (
    <div className="club-admin">
      {reviewAssignment && (
        <Modal
          title={`第 ${roundLabel(event, reviewAssignment.round)} 圈 · ${tableDeviceLabel(event, reviewAssignment)} 成績核對`}
          onClose={() => setReviewId(null)}
        >
          <TableScoreReview event={event} assignment={reviewAssignment} />
        </Modal>
      )}
      <h4>裝置收分</h4>
      {event.club?.enabled && event.status === 'live' &&
        [...new Set(event.assignments.map((a) => a.round))]
          .filter((r) => r < round && !event.club?.finalized.includes(r))
          .sort((a, b) => a - b)
          .map((r) => (
            <div className="alert" key={r}>
              <span>第 {roundLabel(event, r)} 圈尚未結算，成績尚未發布至排名。</span>
              <button type="button" className="button subtle" disabled={busy}
                onClick={() => void act({ action: 'finalize', round: r, force: false, reason: '補結算已完成圈次，保留目前收分狀態' })}>
                補結算第 {roundLabel(event, r)} 圈
              </button>
            </div>
          ))}
      <label className="field">
        收分模式
        <select
          value={mode}
          disabled={busy || !!event.club?.enabled || !!Object.keys(event.results).length}
          onChange={(e) => {
            setMode(e.target.value as 'pair' | 'table');
            setLink('');
            setQr('');
          }}
        >
          {event.kind === 'pairs' && <option value="pair">俱樂部模式 · 裝置跟著搭檔</option>}
          <option value="table">大賽收分模式 · 裝置固定桌次</option>
        </select>
      </label>
      <p>
        {tableMode
          ? '每個桌次共用一個連結，裝置留在桌上；一般隊制賽的開室、閉室各有獨立連結。換圈後自動載入該桌對戰，由指定方輸入、交給對方核對後鎖定。'
          : '一對搭檔共用一個連結。每桌由指定方輸入，另一方確認全部成績。'}
        裁判結算後對觀眾發布。
      </p>
      <p className="footnote">切換模式須先停用，且尚未收分；切換後舊連結失效，須重新簽發。</p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <button
        className="button subtle"
        disabled={busy}
        onClick={() => {
          if (
            event.club?.enabled &&
            !window.confirm('停用後，觀眾將可看到所有已收成績。確定停用？')
          )
            return;
          void act({ action: 'enable', enabled: !event.club?.enabled, mode });
        }}
      >
        {event.club?.enabled ? '停用裝置收分' : tableMode ? '啟用大賽收分模式' : '啟用俱樂部模式'}
      </button>
      <h4>產生 QRCode/重新簽發</h4>
      <label className="field">
        手機可連線的網站網址
        <input
          type="url"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="https://…"
        />
      </label>
      {tableMode && (
        <>
          <p>
            先建立或公布賽程，再為各桌簽發。交錯循環依實體桌號綁定，不隨比較用的開閉室標記變動。
          </p>
          <div className="club-pair-links">
            {devices.map((d) => (
              <button
                key={d.key}
                className="button subtle"
                disabled={busy || !event.club?.enabled}
                onClick={() => {
                  if (
                    event.club?.tokens[d.key] &&
                    !window.confirm(`重新簽發 ${d.label}，使舊連結失效？`)
                  )
                    return;
                  try {
                    const url = new URL(base);
                    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
                  } catch {
                    setError('請填寫有效的 http／https 網址');
                    return;
                  }
                  void act({ action: 'issue-table', deviceKey: d.key });
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          {!devices.length && (
            <p>尚未公布桌次，請先至「賽程與牌局管理」設定賽程或公布 Swiss 首圈。</p>
          )}
        </>
      )}
      {!tableMode && (
        <div className="club-pair-links">
          {event.participants.map((p) => (
            <button
              key={p.id}
              className="button subtle"
              title={`${p.id.toUpperCase()} ${p.name}`}
              aria-label={`${p.id.toUpperCase()} ${p.name}`}
              disabled={busy || !event.club?.enabled}
              onClick={() => {
                if (
                  event.club?.tokens[p.id] &&
                  !window.confirm(`重新簽發 ${p.id.toUpperCase()} 的連結並使舊連結失效？`)
                )
                  return;
                try {
                  const url = new URL(base);
                  if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
                } catch {
                  setError('請填寫有效的 http／https 網址');
                  return;
                }
                void act({ action: 'issue', pair: p.id });
              }}
            >
              <span className="club-pair-label">
                {p.id.toUpperCase()} {p.name}
              </span>
            </button>
          ))}
        </div>
      )}
      {link && (
        <section className="club-link-card">
          <strong>{pair.toUpperCase()} 專屬收分卡</strong>
          {qr && <img src={qr} width={280} height={280} alt={`${pair} 收分 QR code`} />}
          <a href={link} target="_blank" rel="noopener noreferrer">
            開啟收分卡
          </a>
          <input
            aria-label="專屬連結"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            className="button subtle"
            onClick={() => {
              void navigator.clipboard
                .writeText(link)
                .then(() => setNotice('連結已複製。'))
                .catch(() => setError('請選取上方連結手動複製'));
            }}
          >
            複製連結
          </button>
          <small>
            連結僅在本次簽發時顯示，請交給{tableMode ? '對應桌次裝置，不要公開張貼' : '對應搭檔'}。
          </small>
        </section>
      )}
      <h4>
        目前第 {roundLabel(event, round)} 圈 · {finalized ? '已結算' : '未結算'}
      </h4>
      <p>請在上方指定當前圈數與開始／休息狀態。</p>
      <div className="club-progress-list">
        {assignments.map((a) => {
          const accepted = clubAccepted(event, a);
          const received = a.boards.filter((b) => event.results[`${a.id}:${b}`]).length;
          const roles = clubRoles(event, a);
          return (
            <div key={a.id} className="club-progress-row">
              <button
                type="button"
                className="club-progress-info club-progress-trigger"
                aria-haspopup="dialog"
                aria-label={`${tableDeviceLabel(event, a)} 成績核對`}
                onClick={() => setReviewId(a.id)}
              >
                <div className="club-progress-heading">
                  <strong>{tableDeviceLabel(event, a)}</strong>
                  <span
                    className={accepted ? 'club-progress-status accepted' : 'club-progress-status'}
                  >
                    {accepted ? '已認可' : received === a.boards.length ? '待確認' : '待輸入'}
                  </span>
                </div>
                <div className="club-progress-details">
                  <span>
                    已收 {received} / {a.boards.length} 副
                  </span>
                  <span>
                    輸入 {roles.inputPair.toUpperCase()} ／ 確認 {roles.confirmPair.toUpperCase()}
                  </span>
                </div>
              </button>
              <button
                type="button"
                className="button subtle club-progress-action"
                disabled={
                  busy || !event.club?.enabled || finalized || event.status !== 'live' || accepted
                }
                onClick={() => {
                  const missing = a.boards.length - received;
                  if (
                    window.confirm(
                      `${tableDeviceLabel(event, a)}：取消本圈尚未輸入的 ${missing} 副牌，保留已有成績，並由裁判確認鎖定本桌。此操作不結算或發布整圈。確定繼續？`,
                    )
                  )
                    void act({ action: 'complete-table', assignmentId: a.id, round });
                }}
              >
                取消本桌剩餘牌局並且確認輸入
              </button>
            </div>
          );
        })}
      </div>
      <label className="field">
        結算原因
        <input
          value={reason}
          minLength={2}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="button-row">
        <button
          className="button primary"
          disabled={busy || !event.club?.enabled || !round || finalized || reason.trim().length < 2}
          onClick={() => void act({ action: 'finalize', round, force: false, reason })}
        >
          結算並發布本圈
        </button>
        <button
          className="button subtle"
          disabled={busy || !event.club?.enabled || !round || finalized || reason.trim().length < 2}
          onClick={() => {
            const nextReady =
              event.assignments.some((a) => a.round === round + 1) &&
              (!event.swiss || swissRoundComplete(event, round + 1)) &&
              knockoutRoundReady(event, round + 1);
            if (
              window.confirm(
                `將強制確認尚未確認的桌次，並取消本圈所有缺分牌。${nextReady ? '結算後將直接開始下一圈。' : '結算後停留圈間休息，等待後續安排。'}確定結算並發布？`,
              )
            )
              void act({ action: 'finalize', round, force: true, reason });
          }}
        >
          強制結算
        </button>
      </div>
      <h4>輸入方設定</h4>
      <label className="field">
        全局規則
        <select
          value={event.club?.inputRule ?? 'ns'}
          disabled={busy || !event.club?.enabled || event.status === 'finished'}
          onChange={(e) => void act({ action: 'input-rule', inputRule: e.target.value })}
        >
          <option value="ns">總是 NS 輸入</option>
          <option value="ew">總是 EW 輸入</option>
          <option value="lower">參賽編號較小者輸入</option>
          <option value="higher">參賽編號較大者輸入</option>
        </select>
      </label>
      <p className="footnote">
        個別桌次指定優先；改變分工會保留已輸入成績，並請新的確認方重新確認。
      </p>
      <label className="field">
        個別桌次 · 圈次
        <select value={settingsRound} onChange={(e) => setSettingsRound(Number(e.target.value))}>
          {Array.from({ length: event.rounds }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              第 {roundLabel(event, i + 1)} 圈
            </option>
          ))}
        </select>
      </label>
      {event.assignments
        .filter((a) => a.round === settingsRound)
        .map((a) => {
          const roles = clubRoles(event, a);
          const label = (pair: string) =>
            `${pair.toUpperCase()} ${event.participants.find((p) => p.id === pair)?.name ?? ''}`;
          return (
            <label key={a.id} className="field">
              {tableDeviceLabel(event, a)} · 輸入方
              <select
                value={event.club?.inputOverrides?.[a.id] ?? ''}
                disabled={
                  busy ||
                  !event.club?.enabled ||
                  event.status === 'finished' ||
                  event.club?.finalized.includes(a.round)
                }
                onChange={(e) =>
                  void act({
                    action: 'input-table',
                    assignmentId: a.id,
                    inputPair: e.target.value || null,
                  })
                }
              >
                <option value="">依全局規則</option>
                <option value={a.ns}>NS · {label(a.ns)}</option>
                <option value={a.ew}>EW · {label(a.ew)}</option>
              </select>
              <small>
                輸入：{label(roles.inputPair)} ／ 確認：{label(roles.confirmPair)}
              </small>
            </label>
          );
        })}
      {!event.assignments.some((a) => a.round === settingsRound) && <p>此圈尚未安排桌次。</p>}
    </div>
  );
}
