'use client';
import type { ResultInput } from '@/lib/model';
import { resultKey } from '@/lib/model';
import { useCallback, useEffect, useState } from 'react';
import { ArrangementPanel } from './admin/ArrangementPanel';
import { AuditPanel } from './admin/AuditPanel';
import { ImportPanel } from './admin/ImportPanel';
import { PenaltyPanel } from './admin/PenaltyPanel';
import { PublicationPanel } from './admin/PublicationPanel';
import { RoundControlPanel } from './admin/RoundControlPanel';
import { ScorePanel } from './admin/ScorePanel';
import { ClubAdmin } from './club-admin';
import { AdminEvent, api } from './scoreboard-shared';

export function AdminPanel({
  eventId,
  onSaved,
  onDeleted,
}: {
  eventId: string;
  onSaved: (s: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [event, setEvent] = useState<AdminEvent | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [section, setSection] = useState('publish');
  const [assignment, setAssignment] = useState(''),
    [board, setBoard] = useState(1),
    [round, setRound] = useState(1),
    [reason, setReason] = useState('');
  const [input, setInput] = useState<ResultInput>({
    assignmentId: '',
    board: 1,
    level: -1,
    strain: 'NT',
    declarer: 'N',
    doubled: 1,
    tricks: 0,
    lead: '',
  });
  const [importType, setImportType] = useState('results'),
    [importReason, setImportReason] = useState(''),
    [text, setText] = useState(''),
    [preview, setPreview] = useState('');
  const [deleteName, setDeleteName] = useState('');
  const load = useCallback(async () => {
    const e = await api<AdminEvent>(`/api/admin/events/${eventId}`, { cache: 'no-store' });
    setEvent(e);
    return e;
  }, [eventId]);
  useEffect(() => {
    let alive = true;
    setEvent(null);
    load()
      .then((e) => {
        if (alive && e.assignments.length) {
          setRound(e.assignments[0].round);
          setAssignment(e.assignments[0].id);
          setBoard(e.assignments[0].boards[0]);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [load]);
  useEffect(() => {
    const r = event?.results[resultKey(assignment, board)];
    setInput(
      r && r.status !== 'cancelled' && r.status !== 'average'
        ? {
            assignmentId: r.assignmentId,
            board: r.board,
            level: r.level,
            miniBridge: r.miniBridge,
            hcp: r.hcp,
            strain: r.strain,
            declarer: r.declarer,
            doubled: r.doubled,
            tricks: r.tricks,
            lead: r.lead,
          }
        : {
            assignmentId: assignment,
            board,
            level: -1,
            miniBridge: event?.gameMode === 'minibridge',
            strain: 'NT',
            declarer: 'N',
            doubled: 1,
            tricks: 0,
            lead: '',
          },
    );
    setReason('');
  }, [assignment, board, event?.revision]);
  async function save(payload: Record<string, unknown>) {
    if (!event) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/events/${eventId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...payload,
          revision: event.revision,
          requestId: crypto.randomUUID(),
          reason: payload.reason ?? reason,
        }),
      });
      const updated = await load();
      if (!updated.assignments.some((a) => a.id === assignment && a.boards.includes(board))) {
        const first = updated.assignments.find((a) => a.round === round) ?? updated.assignments[0];
        if (first) {
          setRound(first.round);
          setAssignment(first.id);
          setBoard(first.boards[0]);
        }
      }
      await onSaved('已儲存並重新計分。觀眾頁面每 30 秒自動更新，也可手動更新。');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!event) return <section className="panel empty">{error || '載入賽事資料中…'}</section>;
  return (
    <section className="panel admin-panel">
      <div className="panel-heading admin-panel-heading">
        <h3>{event.canDirect ? '裁判後台' : '賽務後台'}</h3>
        <span className="badge admin-version">版本 {event.revision}</span>
        <p className="admin-panel-description">原始結果、排名與更正紀錄一併儲存。</p>
      </div>
      <div className="admin-tabs">
        {[
          ['publish', '比賽資訊'],
          ...(event.canDirect ? [['import', '賽程與牌局管理'], ['club', '圈次與裝置收分']] : []),
          ['score', '裁判更正成績'],
          ['penalty', '判罰調整'],
          ...(event.canDirect ? [['audit', '操作紀錄']] : []),
        ].map(([k, v]) => (
          <button
            key={k}
            className={section === k ? 'selected' : ''}
            onClick={() => {
              setSection(k);
              setError('');
            }}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="admin-content">
        {error && (
          <div className="alert error" role="alert">
            {error}
            <button
              onClick={() => {
                load()
                  .then(() => setError(''))
                  .catch((e) => setError(e.message));
              }}
            >
              重新載入
            </button>
          </div>
        )}
        {section === 'club' && event.canDirect && <>
          <RoundControlPanel busy={busy} event={event} save={save} />
          <ClubAdmin event={event} reload={load} disabled={busy} onBusyChange={setBusy} />
        </>}
        {!event.rounds && (
          <p className="footnote">
            待設定賽程：請至「賽程與牌局管理」選擇賽程編排，設定圈數與每圈牌數後再開始收分。
          </p>
        )}
        {section === 'score' && event.rounds > 0 && (
          <ScorePanel
            assignment={assignment}
            board={board}
            busy={busy}
            event={event}
            input={input}
            reason={reason}
            round={round}
            save={save}
            setAssignment={setAssignment}
            setBoard={setBoard}
            setInput={setInput}
            setReason={setReason}
            setRound={setRound}
          />
        )}
        {section === 'import' && event.canDirect && (
          <ImportPanel
            busy={busy}
            event={event}
            importReason={importReason}
            importType={importType}
            preview={preview}
            save={save}
            setError={setError}
            setImportReason={setImportReason}
            setImportType={setImportType}
            setPreview={setPreview}
            setText={setText}
            text={text}
          />
        )}
        {section === 'import' && event.canDirect && (
          <ArrangementPanel busy={busy} event={event} save={save} />
        )}
        {(section === 'publish' || (section === 'import' && event.canDirect)) && (
          <PublicationPanel
            section={section === 'publish' ? 'information' : 'boards'}
            busy={busy}
            deleteName={deleteName}
            event={event}
            eventId={eventId}
            onDeleted={onDeleted}
            save={save}
            setBusy={setBusy}
            setDeleteName={setDeleteName}
            setError={setError}
          />
        )}
        {section === 'penalty' && <PenaltyPanel busy={busy} event={event} save={save} />}
        {section === 'audit' && event.canDirect && <AuditPanel event={event} />}
      </div>
    </section>
  );
}
