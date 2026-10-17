'use client';
import { isInterleaved, teamByes, roundLabel } from '@/lib/team-movement';
import { boardGroups, boardRange } from '@/lib/board-groups';
import {
  exportMovement,
  exportPbn,
  exportResultsCsv,
  parseMovement,
  parseByeVp,
  parsePbn,
  parseResultsCsv,
} from '@/lib/imports';
import { exportLineups, lineupRosterAdditions, parseLineups } from '@/lib/lineup-import';
import type { BridgeEvent, PublicEvent, ResultInput, Seat } from '@/lib/model';
import { resultKey } from '@/lib/model';
import { participantNumber } from '@/lib/participant-number';
import { exportRosters, parseRosters } from '@/lib/roster-import';
import { allRoundsComplete, roundProgress } from '@/lib/round-progress';
import { exportRoundTimes, parseRoundTimes } from '@/lib/round-times-import';
import { awardedResult, contractScore } from '@/lib/scoring';
import { ArrowDownToLine, Check } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ClearResults } from './clear-results';
import { ClubAdmin } from './club-admin';
import { EditorPopover } from './editor-popover';
import { MiniContractFields } from './mini-contract-fields';
import { SwissPanel } from './swiss-panel';
import { MovementPanel } from './movement-panel';
import { RandomDealsPanel } from './random-deals-panel';
import {
  AdminEvent,
  api,
  displayContract,
  download,
  number,
  resultText,
  seatNames,
  signed,
  suitSymbols,
  vulNames,
} from './scoreboard-shared';
import { SplitContractEditor } from './split-contract-editor';
function RoundStateFields({ event }: { event: PublicEvent }) {
  const progress = roundProgress(event);
  const [selectedRound, setSelectedRound] = useState(progress.round);
  const complete = allRoundsComplete(event) || event.status === 'finished';
  const selectedProgress = roundProgress({ ...event, currentRound: selectedRound });
  const collected =
    selectedRound > 0 &&
    selectedProgress.expected > 0 &&
    selectedProgress.received === selectedProgress.expected;
  return (
    <div className="form-grid">
      <label className="field">
        目前圈數
        <select
          name="round"
          value={selectedRound}
          onChange={(e) => setSelectedRound(Number(e.target.value))}
        >
          <option value="0">尚未開始</option>
          {Array.from({ length: event.rounds }, (_, i) => (
            <option
              key={i}
              value={i + 1}
              disabled={!event.assignments.some((a) => a.round === i + 1)}
            >
              第 {roundLabel(event, i + 1)} 圈
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        進度狀態
        {selectedRound === 0 || complete || collected ? (
          <>
            <select disabled value="automatic">
              <option value="automatic">
                {complete ? '賽事已結束' : selectedRound === 0 ? '尚未開始' : '圈間休息'}
              </option>
            </select>
            <input type="hidden" name="phase" value={selectedRound === 0 ? 'playing' : 'break'} />
          </>
        ) : (
          <select
            name="phase"
            key={selectedRound}
            defaultValue={
              selectedRound === progress.round ? (event.roundPhase ?? 'playing') : 'playing'
            }
          >
            <option value="playing">進行中</option>
            <option value="break">圈間休息</option>
          </select>
        )}
      </label>
    </div>
  );
}

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
    [section, setSection] = useState('score');
  const [assignment, setAssignment] = useState(''),
    [board, setBoard] = useState(1),
    [round, setRound] = useState(1),
    [reason, setReason] = useState('');
  const [input, setInput] = useState<ResultInput>({
    assignmentId: '',
    board: 1,
    level: 3,
    strain: 'NT',
    declarer: 'N',
    doubled: 1,
    tricks: 9,
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
            strain: r.strain,
            declarer: r.declarer,
            doubled: r.doubled,
            tricks: r.tricks,
            lead: r.lead,
          }
        : {
            assignmentId: assignment,
            board,
            level: 3,
            miniBridge: event?.gameMode === 'minibridge',
            strain: 'NT',
            declarer: 'N',
            doubled: 1,
            tricks: 9,
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
  function previewImport() {
    if (!event) return;
    setError('');
    setPreview('');
    try {
      if (importType === 'results') {
        const rows = parseResultsCsv(text);
        for (const r of rows) {
          const a = event.assignments.find((a) => a.id === r.assignmentId);
          if (!a?.boards.includes(r.board))
            throw new Error(`桌次 ${r.assignmentId}／牌 ${r.board} 不在賽程內`);
        }
        setPreview(
          `共 ${rows.length} 筆成績，將新增或覆寫相同桌次／牌號。前 5 筆：\n${rows
            .slice(0, 5)
            .map(
              (r) =>
                `${r.assignmentId} · B${r.board} · ${r.status === 'cancelled' ? 'Cancelled（取消，不計分）' : `${displayContract(r)} ${r.declarer} ${resultText(r)}`}`,
            )
            .join('\n')}`,
        );
      } else if (importType === 'rosters') {
        const rows = parseRosters(text, event);
        setPreview(
          '更新 ' +
            rows.length +
            ' 隊名單（未列出的隊伍保持不變）：\n' +
            rows
              .map(
                (r) =>
                  r.teamName +
                  '：隊長 ' +
                  (r.captain || '未設定') +
                  '；賽員 ' +
                  (r.players.join('、') || '清空'),
              )
              .join('\n'),
        );
      } else if (importType === 'lineups') {
        const rows = parseLineups(text, event);
        const additions = lineupRosterAdditions(rows, event);
        setPreview(
          `共 ${rows.length} 組入座名單；僅更新所列桌次。\n${rows.map((r) => `${r.assignmentId}：${(['N', 'E', 'S', 'W'] as const).map((s) => `${s} ${r.playerNames[s] || '未指定'}`).join(' ／ ')}`).join('\n')}${additions.length ? '\n將新增隊員：\n' + additions.map((a) => `${a.teamName}：${a.names.join('、')}`).join('\n') : ''}`,
        );
      } else if (importType === 'round-times') {
        const rows = parseRoundTimes(text, event);
        const local = (value: string) =>
          new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
        setPreview(
          `共 ${rows.length} 圈時間（臺灣時間），僅更新所列圈次：\n${rows.map((row) => `第 ${roundLabel(event, row.round)} 圈：${row.startAt && row.endAt ? `${local(row.startAt)} — ${local(row.endAt)}` : '清除時間'}`).join('\n')}`,
        );
      } else if (importType === 'pbn') {
        const boards = parsePbn(text);
        setPreview(
          `共 ${boards.length} 副完整牌型：${boards.map((b) => b.number).join(', ')}。需與全場牌號一致，且尚未收分。`,
        );
      } else {
        const rows = parseMovement(text, event as BridgeEvent);
        const byes = teamByes({ ...event, assignments: rows, byeVp: parseByeVp(text) ?? event.byeVp });
        setPreview(`共 ${rows.length} 組桌次安排。${isInterleaved(rows) ? '交錯循環須完整匯入，已有成績後禁止重匯；每場依同一對戰的兩桌實際圈次比較。' : event.kind === 'teams' ? '僅更新所列圈次，未列出的圈次保持不變，已收分圈次不得改動。' : '首次匯入會取代尚未收分的預設賽程。'}${byes.length ? '\n輪空：' + byes.map(b => `第 ${b.round} 圈 ${event.participants.find(p => p.id === b.participantId)?.name}，${b.vp} VP`).join('；') : ''}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!event) return <section className="panel empty">{error || '載入賽事資料中…'}</section>;
  const selected = event.assignments.find((a) => a.id === assignment),
    existing = event.results[resultKey(assignment, board)];
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;
  return (
    <section className="panel admin-panel">
      <div className="panel-heading admin-panel-heading">
        <h3>{event.canDirect ? '裁判後台' : '賽務後台'}</h3>
        <span className="badge admin-version">版本 {event.revision}</span>
        <p className="admin-panel-description">原始結果、排名與更正紀錄一併儲存。</p>
      </div>
      <div className="admin-tabs">
        {[
          ['score', '收分／更正'],
          ...(event.canDirect ? [['import', '匯入／匯出']] : []),
          ['publish', event.canDirect ? '圈次與發布設定' : '賽事設定'],
          ['penalty', '判罰調整'],
          ...(event.canDirect ? [['audit', '操作紀錄']] : []),
          ...(event.canDirect && event.kind === 'pairs' ? [['club', '俱樂部收分']] : []),
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
        {section === 'club' && event.canDirect && event.kind === 'pairs' && (
          <ClubAdmin event={event} reload={load} />
        )}
        {section === 'publish' && event.canDirect && (
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
                圈數會隨收分進度往前更新；該圈收齊後進入圈間休息，全部收齊後顯示賽事已結束。
              </p>
              <button className="button primary" disabled={busy || event.status === 'finished'}>
                儲存目前圈數
              </button>
              {event.status === 'finished' && (
                <p className="footnote">賽事已結束；重新開放後才可調整目前圈數。</p>
              )}
            </form>
          </>
        )}
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
        {!event.rounds && <p className="footnote">待設定賽程：請至「匯入／匯出」選擇賽程編排，設定圈數與每圈牌數後再開始收分。</p>}
        {section === 'score' && event.rounds > 0 && (
          <>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await save({
                  action: 'results',
                  results: [{ ...input, assignmentId: assignment, board }],
                });
              }}
            >
              <div className="form-grid">
                <label className="field">
                  圈次
                  <select
                    value={round}
                    onChange={(e) => {
                      const r = Number(e.target.value),
                        a = event.assignments.find((a) => a.round === r)!;
                      setRound(r);
                      setAssignment(a.id);
                      setBoard(a.boards[0]);
                    }}
                  >
                    {[...new Set(event.assignments.map((a) => a.round))]
                      .sort((a, b) => a - b)
                      .map((r) => (
                        <option value={r} key={r}>
                          {roundLabel(event, r)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  桌次
                  <select
                    value={assignment}
                    onChange={(e) => {
                      const a = event.assignments.find((a) => a.id === e.target.value)!;
                      setAssignment(a.id);
                      setBoard(a.boards[0]);
                    }}
                  >
                    {event.assignments
                      .filter((a) => a.round === round)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.table}
                          {event.kind === 'teams' && !event.teamMovement
                            ? a.room === 'open'
                              ? ' · 開室'
                              : ' · 閉室'
                            : ''}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="seating-note">
                {(['NS', 'EW'] as const).map((side) => {
                  const id = selected?.[side === 'NS' ? 'ns' : 'ew'];
                  const standing = event.projection.standings.find((s) => s.id === id);
                  const method = event.pairMethod ?? 'mp';
                  const score = standing?.score;
                  const summary = id
                    ? `${participantNumber(id, event.kind)} / ${score == null ? '—' : `${score >= 0 && method !== 'mp' ? '+' : ''}${number(score, method === 'butler' && Number.isInteger(score) ? 0 : 2)}${event.kind === 'teams' ? ' VP' : method === 'mp' ? '%' : ' IMP'}`}${standing ? ` / #${standing.rank}` : ''}`
                    : '—';
                  return (
                    <div className="seating-participant" key={side}>
                      <div className="seating-name" title={id ? name(id) : ''}>
                        <b>{side}</b>
                        <span>{id ? name(id) : '—'}</span>
                      </div>
                      <small title={summary}>{summary}</small>
                    </div>
                  );
                })}
              </div>
              {event.kind === 'teams' && selected && (
                <fieldset key={`${selected.id}-${event.revision}`}>
                  <legend>本桌上場賽員</legend>
                  <div className="form-grid">
                    {(['N', 'E', 'S', 'W'] as const).map((seat) => {
                      const team = event.participants.find(
                        (p) => p.id === (seat === 'N' || seat === 'S' ? selected.ns : selected.ew),
                      );
                      return (
                        <label className="field" key={seat}>
                          {{ N: '北', E: '東', S: '南', W: '西' }[seat]} · {team?.name}
                          <select
                            name={`seat-${seat}`}
                            defaultValue={selected.playerNames?.[seat] ?? ''}
                          >
                            <option value="">尚未指定</option>
                            {team?.players
                              .split('、')
                              .filter(Boolean)
                              .map((n) => (
                                <option key={n}>{n}</option>
                              ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="button subtle"
                    disabled={busy}
                    onClick={(e) => {
                      const data = new FormData(e.currentTarget.form!);
                      void save({
                        action: 'table-lineup',
                        assignmentId: selected.id,
                        playerNames: Object.fromEntries(
                          ['N', 'E', 'S', 'W'].map((s) => [s, String(data.get(`seat-${s}`) ?? '')]),
                        ),
                        reason: '更新本桌東南西北姓名',
                      });
                    }}
                  >
                    儲存上場名單
                  </button>
                </fieldset>
              )}
              <div className="form-grid four">
                <label className="field">
                  牌號
                  <select value={board} onChange={(e) => setBoard(Number(e.target.value))}>
                    {selected?.boards.map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                </label>
                {event.gameMode === 'minibridge' ? (
                  <MiniContractFields value={input} onChange={setInput} />
                ) : (
                  <>
                    <label className="field">
                      線位
                      <select
                        value={input.level}
                        onChange={(e) => {
                          const level = Number(e.target.value);
                          setInput({ ...input, level, tricks: level ? level + 6 : 0, doubled: 1 });
                        }}
                      >
                        {Array.from({ length: 8 }, (_, i) => (
                          <option value={i} key={i}>
                            {i || 'Pass out'}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      合約花色
                      <select
                        disabled={!input.level}
                        value={input.strain}
                        onChange={(e) =>
                          setInput({ ...input, strain: e.target.value as ResultInput['strain'] })
                        }
                      >
                        {['C', 'D', 'H', 'S', 'NT'].map((s) => (
                          <option value={s} key={s}>
                            {suitSymbols[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      加倍
                      <select
                        disabled={!input.level}
                        value={input.doubled}
                        onChange={(e) =>
                          setInput({ ...input, doubled: Number(e.target.value) as 1 | 2 | 4 })
                        }
                      >
                        <option value={1}>未加倍</option>
                        <option value={2}>X</option>
                        <option value={4}>XX</option>
                      </select>
                    </label>
                  </>
                )}
                <label className="field">
                  莊家
                  <select
                    disabled={!input.level}
                    value={input.declarer}
                    onChange={(e) => setInput({ ...input, declarer: e.target.value as Seat })}
                  >
                    {(['N', 'E', 'S', 'W'] as Seat[]).map((s) => (
                      <option key={s} value={s}>
                        {seatNames[s]} {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  實得墩數
                  <input
                    type="number"
                    min={0}
                    max={13}
                    required
                    disabled={!input.level}
                    value={input.tricks}
                    onChange={(e) => setInput({ ...input, tricks: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  首攻（選填）
                  <input
                    maxLength={4}
                    value={input.lead}
                    placeholder="例如 SA"
                    onChange={(e) => setInput({ ...input, lead: e.target.value.toUpperCase() })}
                  />
                </label>
                <div className="score-preview">
                  <span>NS 原始分</span>
                  <strong>
                    {signed(
                      contractScore(
                        input,
                        event.boards.find((b) => b.number === board)?.vulnerability ?? 'None',
                        event.gameMode === 'minibridge',
                      ),
                    )}
                  </strong>
                  <small>
                    {
                      vulNames[
                        event.boards.find((b) => b.number === board)?.vulnerability ?? 'None'
                      ]
                    }
                  </small>
                </div>
              </div>
              <label className="field">
                {existing ? '更正原因（選填）' : '紀錄說明（選填）'}
                <input
                  maxLength={200}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {existing && (
                <p className="footnote">
                  目前紀錄：{displayContract(existing)} {existing.declarer} {resultText(existing)}
                  ，NS {signed(existing.nsScore)}。提交後會保留前後差異。
                </p>
              )}
              <div className="button-row score-actions">
                <button
                  className="button subtle"
                  disabled={
                    busy ||
                    event.status === 'finished' ||
                    !!existing?.split ||
                    existing?.status === 'cancelled'
                  }
                >
                  <Check size={16} />
                  {busy ? '儲存中…' : existing ? '儲存更正並重算' : '提交成績'}
                </button>
                <button
                  type="button"
                  className={existing?.status === 'cancelled' ? 'button subtle' : 'button danger'}
                  disabled={
                    busy ||
                    event.status === 'finished' ||
                    !!existing?.split
                  }
                  onClick={() =>
                    save({
                      action: 'ruling',
                      assignmentId: assignment,
                      board,
                      cancelled: existing?.status !== 'cancelled',
                      ...(existing?.status === 'cancelled'
                        ? { result: { ...input, assignmentId: assignment, board } }
                        : {}),
                      reason,
                    })
                  }
                >
                  {existing?.status === 'cancelled' ? '恢復合約' : '取消此副'}
                </button>
              </div>
              {event.status === 'finished' && (
                <p className="footnote">賽事已結束；更正前請至發布設定重新開放。</p>
              )}
            </form>
            {event.canDirect &&
              event.kind === 'teams' &&
              existing &&
              existing.status !== 'cancelled' &&
              existing.status !== 'average' &&
              selected && (
                <SplitContractEditor
                  key={assignment + ':' + board + ':' + event.revision}
                  result={existing}
                  names={{ ns: name(selected.ns), ew: name(selected.ew) }}
                  vulnerability={
                    event.boards.find((b) => b.number === board)?.vulnerability ?? 'None'
                  }
                  miniBridge={event.gameMode === 'minibridge'}
                  disabled={busy || event.status === 'finished'}
                  save={save}
                />
              )}
          </>
        )}
        {section === 'import' && event.canDirect && (
          <>
            <form
              className="round-settings-form import-export-section"
              key={`board-number-${event.maxBoardNumber}`}
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void save({
                  action: 'settings',
                  status: event.status,
                  maxBoardNumber: Number(data.get('maxBoardNumber')),
                  reason: '設定循環顯示最大牌號',
                });
              }}
            >
              <label className="field">
                最大牌號
                <input
                  name="maxBoardNumber"
                  type="number"
                  min="0"
                  required
                  defaultValue={event.maxBoardNumber ?? (event.kind === 'pairs' ? 0 : 32)}
                />
              </label>
              <p className="footnote">
                0 表示不設上限，牌號持續遞增；設定正整數則超過後從牌號 1
                重新顯示。各圈成績仍獨立保存。
              </p>
              <button className="button subtle" disabled={busy}>
                儲存最大牌號
              </button>
            </form>
            <SwissPanel key={`swiss-${event.id}-${event.revision}`} event={event as BridgeEvent} busy={busy} save={save} />
            {!event.swiss && (
              <MovementPanel
                key={`movement-${event.id}-${event.revision}`}
                event={event as BridgeEvent}
                busy={busy}
                save={save}
              />
            )}
            <RandomDealsPanel
              key={`deals-${event.id}-${event.revision}`}
              boards={event.boards}
              locked={Object.keys(event.results).length > 0}
              busy={busy}
              save={save}
            />
            <section className="import-export-section">
              <h4>匯入資料</h4>
              <label className="field">
                匯入類型
                <select
                  value={importType}
                  onChange={(e) => {
                    setImportType(e.target.value);
                    setPreview('');
                    setText('');
                  }}
                >
                  <option value="results">成績 CSV</option>
                  <option value="pbn">完整牌型 PBN</option>
                  <option value="round-times">各圈時間區間 CSV</option>
                  {!event.swiss && <option value="movement">賽程編排 CSV</option>}
                  {event.kind === 'teams' && <option value="rosters">隊伍賽員名單 CSV</option>}
                  {event.kind === 'teams' && <option value="lineups">入座名單 CSV</option>}
                </select>
              </label>
              <label className="field">
                選擇檔案（最多 200 KB）
                <input
                  type="file"
                  accept={importType === 'pbn' ? '.pbn' : '.csv'}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      if (file.size > 200000) {
                        setError('檔案超過 200 KB');
                        return;
                      }
                      setText(await file.text());
                      setPreview('');
                    }
                  }}
                />
              </label>
              <label className="field">
                或貼上內容
                <textarea
                  rows={8}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPreview('');
                  }}
                  placeholder={
                    importType === 'results'
                      ? 'assignmentId,board,level,strain,doubled,declarer,tricks,lead\nr1m1o,1,3,NT,1,N,9,SA'
                      : importType === 'rosters'
                        ? `teamId,teamName,captain,players\n${event.participants[0]?.id ?? 't1'},隊伍名稱,隊長姓名,賽員甲;賽員乙`
                        : importType === 'lineups'
                          ? 'assignmentId,N,E,S,W\nr1m1o,北家姓名,東家姓名,南家姓名,西家姓名'
                          : importType === 'movement'
                            ? event.kind === 'teams'
                              ? 'round,table,room,ns,ew,boards\n1,1,open,p1,p2,1;2\n1,1,closed,p2,p1,1;2'
                              : 'round,table,ns,ew,boards\n1,1,p1,p2,1;2'
                            : importType === 'round-times'
                              ? 'round,startAt,endAt\n1,09:00,09:30\n2,09:35,10:05'
                              : '[Board "1"]\n[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:..."]'
                  }
                />
              </label>
              <label className="field">
                匯入說明（選填）
                <input
                  maxLength={200}
                  value={importReason}
                  onChange={(e) => setImportReason(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button className="button subtle" onClick={previewImport}>
                  驗證並預覽
                </button>
                <button
                  className="button primary"
                  disabled={!preview || busy}
                  onClick={async () => {
                    try {
                      const payload =
                        importType === 'results'
                          ? { action: 'results-import', csv: text }
                          : importType === 'rosters'
                            ? { action: 'rosters-import', csv: text }
                            : importType === 'lineups'
                              ? { action: 'lineups-import', csv: text }
                              : importType === 'pbn'
                                ? { action: 'pbn', pbn: text }
                                : importType === 'round-times'
                                  ? { action: 'round-times-import', csv: text }
                                  : { action: 'movement', csv: text };
                      if (await save({ ...payload, reason: importReason })) {
                        setPreview('');
                        setText('');
                        setImportReason('');
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {busy ? '匯入中…' : '確認匯入'}
                </button>
              </div>
              {preview && <pre className="import-preview">{preview}</pre>}
              <p className="footnote">
                {importType === 'results'
                  ? '可下載成績 CSV 修改後匯入；保留 assignmentId 與 board。status 可填 played 或 cancelled；取消牌不計分，合約欄可全部留空。匯入 played 會恢復該筆取消成績，請先核對預覽。'
                  : importType === 'rosters'
                    ? '每隊一列，以 teamId 對應現有隊伍，teamName 僅供辨識。賽員以頓號或分號（;／；）分隔；取代所列隊伍的完整名單與隊長，留白表示清空。未列出的隊伍保持不變；仍在入座名單中的賽員不可移除。'
                    : importType === 'lineups'
                      ? '欄位：assignmentId,N,E,S,W。新姓名會自動加入該座位所屬隊伍，預覽會列出新增隊員。空白座位表示清除，未列出的桌次保持不變。'
                      : importType === 'pbn'
                        ? '牌型僅能在尚未收分時替換。'
                        : importType === 'round-times'
                          ? '欄位：round,startAt,endAt。時間使用 HH:mm（賽段開始日期）或 YYYY-MM-DD HH:mm，皆為臺灣時間。只更新所列圈次；開始與結束皆留空可清除該圈時間。時間不會自動切換圈次。'
                          : `可先匯出賽程再修改，逐圈匯入時每圈須包含完整賽程；已收分的圈次不可更改，已結束賽事須先重新開放。${event.kind === 'teams' ? '一般隊制賽填 room：open／closed，同桌兩室方向相反、牌組相同。交錯循環另填 matchId 配對跨圈兩桌，須在收分前一次匯入完整賽程。奇數隊輪空可附 byeVp，預設 12。' : ''}`}
              </p>
            </section>
            <section className="import-export-section">
              <h4>匯出資料</h4>
              <p>下載目前賽事的成績、賽程或牌型。</p>
              <div className="button-row export-row">
                {event.kind === 'teams' && (
                  <button
                    className="button subtle"
                    onClick={() =>
                      download(event.id + '-rosters.csv', exportRosters(event), 'text/csv')
                    }
                  >
                    <ArrowDownToLine size={16} />
                    隊伍賽員名單 CSV
                  </button>
                )}
                {event.kind === 'teams' && (
                  <button
                    className="button subtle"
                    onClick={() =>
                      download(`${event.id}-lineups.csv`, exportLineups(event), 'text/csv')
                    }
                  >
                    <ArrowDownToLine size={16} />
                    入座名單 CSV
                  </button>
                )}
                <button
                  className="button subtle"
                  onClick={() =>
                    download(`${event.id}-round-times.csv`, exportRoundTimes(event), 'text/csv')
                  }
                >
                  <ArrowDownToLine size={16} />
                  各圈時間區間 CSV
                </button>
                <button
                  className="button subtle"
                  onClick={() =>
                    download(
                      `${event.id}-results.csv`,
                      exportResultsCsv(event as BridgeEvent),
                      'text/csv',
                    )
                  }
                >
                  <ArrowDownToLine size={16} />
                  成績 CSV
                </button>
                <button
                  className="button subtle"
                  onClick={() =>
                    download(
                      `${event.id}-movement.csv`,
                      exportMovement(event as BridgeEvent),
                      'text/csv',
                    )
                  }
                >
                  <ArrowDownToLine size={16} />
                  賽程編排 CSV
                </button>
                <button
                  className="button subtle"
                  onClick={() => download(`${event.id}.pbn`, exportPbn(event as BridgeEvent))}
                >
                  <ArrowDownToLine size={16} />
                  牌型 PBN
                </button>
                <button
                  className="button subtle"
                  onClick={() =>
                    download(
                      `${event.id}-backup.json`,
                      JSON.stringify(event, null, 2),
                      'application/json',
                    )
                  }
                >
                  <ArrowDownToLine size={16} />
                  賽事資料 JSON
                </button>
              </div>
            </section>
          </>
        )}
        {section === 'import' && event.canDirect && (
          <ClearResults
            name={event.stageName || event.name}
            count={Object.keys(event.results).length}
            busy={busy}
            save={save}
          />
        )}
        {section === 'publish' && (
          <>
            {event.canDirect && (
              <form
                className="event-identity-form"
                key={`${event.stageName}-${event.date}-${event.endDate}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void save({
                    action: 'settings',
                    status: event.status,
                    ...((event.hasStages || event.parentEventId) ? { stageName: String(form.get('name')) } : {}),
                    date: String(form.get('date')),
                    endDate: String(form.get('endDate')) || null,
                    reason: '修改賽段資訊',
                  });
                }}
              >
                <h4>賽段資訊</h4>
                {(event.hasStages || event.parentEventId) && <label className="field">
                  賽段名稱
                  <input
                    name="name"
                    minLength={1}
                    maxLength={80}
                    required
                    defaultValue={event.stageName ?? event.name}
                  />
                </label>}
                <label className="field">
                  開始日期
                  <input name="date" type="date" required defaultValue={event.date} />
                </label>
                <label className="field">
                  結束日期（選填）
                  <input name="endDate" type="date" defaultValue={event.endDate ?? ''} />
                </label>
                <p className="footnote">單日賽段可將結束日期留空。</p>
                <button className="button subtle" disabled={busy}>
                  儲存賽段資訊
                </button>
              </form>
            )}
            <p className="footnote">
              名稱、前綴與地點等共用資訊，請至{' '}
              <a
                href={`/?competition=${encodeURIComponent(event.competition?.id ?? event.parentEventId ?? event.id)}`}
              >
                賽事主頁
              </a>{' '}
              編輯。
            </p>
            {event.canDirect && (
              <>
                <h4>依牌組公開牌型</h4>
                <p>
                  每個按鈕一次公開或隱藏所列牌號的手牌、PBN 與雙夢家分析。牌組由 PBN
                  指定，未指定時依每圈牌數自動分組。已下載的牌型無法收回。
                </p>
                <div className="publication-grid">
                  {boardGroups(event.boards, event.boardsPerRound).map((group) => {
                    const b = group[0];
                    const published = group.every((item) => item.published ?? event.publishBoards);
                    const label = boardRange(group.map((item) => item.number));
                    return (
                      <button
                        key={b.number}
                        disabled={busy}
                        aria-pressed={published}
                        className={`button ${published ? 'primary' : 'subtle'}`}
                        onClick={() =>
                          save({
                            action: 'board-publication',
                            board: b.number,
                            published: !published,
                            reason: `牌 ${label} ${published ? '隱藏' : '公開'}牌型`,
                          })
                        }
                      >
                        {label} · {published ? '已公開' : '隱藏中'}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <form
              className="setting-row event-description-settings"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void save({
                  action: 'settings',
                  status: event.status,
                  awardPlaces: Number(form.get('awardPlaces')),
                  awardDescription: String(form.get('awardDescription') ?? ''),
                  movementDescription: String(form.get('movementDescription') ?? ''),
                  reason: '設定給獎與賽程說明',
                });
              }}
            >
              <label className="field">
                給獎至第幾名（0 表示不給獎）
                <input
                  key={event.awardPlaces ?? 3}
                  name="awardPlaces"
                  type="number"
                  min="0"
                  max="32"
                  required
                  defaultValue={event.awardPlaces ?? 3}
                />
              </label>
              <label className="field">
                給獎內容
                <textarea
                  name="awardDescription"
                  maxLength={2000}
                  defaultValue={event.awardDescription ?? ''}
                />
              </label>
              <label className="field">
                賽程編排說明
                <textarea
                  name="movementDescription"
                  maxLength={4000}
                  defaultValue={event.movementDescription ?? ''}
                />
              </label>
              <button className="button subtle" disabled={busy}>
                儲存給獎與賽程說明
              </button>
            </form>
            <div className="setting-row">
              <div>
                <strong>賽事狀態</strong>
                <p>收齊全部成績後才可結束；結束後停止自動更新。</p>
              </div>
              <button
                disabled={busy}
                className="button subtle"
                onClick={() =>
                  save({
                    action: 'settings',
                    status: event.status === 'live' ? 'finished' : 'live',
                  })
                }
              >
                {event.status === 'live' ? '結束賽事' : '重新開放更正'}
              </button>
            </div>
            {event.canDirect && (
              <form
                className="import-export-section"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    await api(`/api/admin/events/${eventId}`, {
                      method: 'DELETE',
                      body: JSON.stringify({ confirmName: deleteName, revision: event.revision }),
                    });
                    await onDeleted();
                  } catch (error) {
                    setError((error as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h4>刪除賽事</h4>
                <p>
                  永久刪除此賽事的賽程、成績與操作紀錄。請輸入完整賽事名稱「{event.name}」確認。
                </p>
                <label className="field">
                  確認賽事名稱
                  <input
                    value={deleteName}
                    onChange={(e) => setDeleteName(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button className="button primary" disabled={busy || deleteName !== event.name}>
                  永久刪除賽事
                </button>
              </form>
            )}
          </>
        )}
        {section === 'penalty' && (
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
        )}
        {section === 'audit' && event.canDirect && (
          <div className="audit-list">
            {[...(event.audit ?? [])].reverse().map((a) => (
              <div className="audit-item" key={a.revision}>
                <span className="audit-dot" />
                <div>
                  <strong>
                    {a.action} <small>v{a.revision}</small>
                  </strong>
                  <p>{a.reason}</p>
                  {a.detail && <p className="mono">{a.detail}</p>}
                  <small>
                    {new Date(a.at).toLocaleString('zh-TW', {
                      timeZone: 'Asia/Taipei',
                      hour12: false,
                    })}
                  </small>
                  {a.changes && (
                    <EditorPopover title={`${a.changes.length} 筆結果變更`}>
                      {a.changes.map((c) => (
                        <p className="mono" key={c.key}>
                          {c.key}：
                          {(c.before?.split || c.after?.split) && (
                            <span className="block">
                              不平衡合約：
                              {[c.before, c.after]
                                .map((r) =>
                                  r?.split
                                    ? (['ns', 'ew'] as const)
                                        .map((side) => {
                                          const awarded = awardedResult(r, side)!;
                                          return `${side.toUpperCase()} ${displayContract(awarded)} ${awarded.declarer} ${resultText(awarded)}（NS 座標 ${signed(awarded.nsScore)}）`;
                                        })
                                        .join('；')
                                    : '無判罰',
                                )
                                .join(' → ')}
                            </span>
                          )}
                          {c.before
                            ? c.before.status === 'cancelled'
                              ? 'Cancelled'
                              : `${displayContract(c.before)} ${c.before.declarer} ${resultText(c.before)} (${c.before.nsScore})`
                            : '未收分'}{' '}
                          →{' '}
                          {c.after
                            ? c.after.status === 'cancelled'
                              ? 'Cancelled'
                              : `${displayContract(c.after)} ${c.after.declarer} ${resultText(c.after)} (${c.after.nsScore})`
                            : '刪除'}
                        </p>
                      ))}
                    </EditorPopover>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
