'use client';
import { Modal } from './event-dialogs';
import { useState } from 'react';
import type { BridgeEvent } from '@/lib/model';
import { swissBasisChanged, swissPreview, swissRoundComplete } from '@/lib/swiss';
import { isInterleaved } from '@/lib/team-movement';
import { boardRange } from '@/lib/board-groups';
import { playerBoardError, playerBoardWarning } from '@/lib/schedule-limits';

export function SwissPanel({
  event,
  busy,
  save,
}: {
  event: BridgeEvent;
  busy: boolean;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useState<'current' | 'delayed'>(event.swiss?.mode ?? 'current');
  const [rounds, setRounds] = useState(event.rounds || 3);
  const [boards, setBoards] = useState(event.boardsPerRound || 8);
  const [byeVp, setByeVp] = useState(event.byeVp ?? (event.teamMethod === 'bam' ? 0 : 12));
  const firstPending = Array.from({ length: event.rounds }, (_, i) => i + 1).find(
    (r) => !swissRoundComplete(event, r),
  );
  const [round, setRound] = useState(firstPending ?? event.rounds);
  const [partial, setPartial] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof swissPreview> | null>(null);
  const [error, setError] = useState('');
  if (event.kind !== 'teams' || event.teamMovement || isInterleaved(event.assignments)) return null;
  const locked = event.status === 'finished';
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;
  const changed = event.swiss?.publications.filter((p) => swissBasisChanged(event, p)) ?? [];
  const plannedBoards = Array.from(
    { length: Math.max(0, Math.min(16, event.boardsPerRound)) },
    (_, i) => (round - 1) * event.boardsPerRound + i + 1,
  );
  return (
    <section className="import-export-section">
      <h4>Swiss 隊制賽</h4>
      {!event.swiss ? (
        <>
          <p>
            逐圈依累計 VP
            配對，排除判罰；只適用一般開閉室隊制賽。設定後會取代尚未收分的整場賽程，之後逐圈預覽與公布。
          </p>
          <div className="form-grid">
            <label className="field">
              安排模式
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="current">當圈安排：第 N 圈成績安排 N+1 圈</option>
                <option value="delayed">隔圈安排：第 N 圈成績安排 N+2 圈</option>
              </select>
            </label>
            <label className="field">
              圈數
              <input
                type="number"
                min={1}
                max={
                  event.participants.length % 2
                    ? event.participants.length
                    : event.participants.length - 1
                }
                value={rounds || ''}
                onChange={(e) => setRounds(Number(e.target.value))}
              />
            </label>
            <label className="field">
              每圈牌數
              <input
                type="number"
                min={1}
                max={16}
                value={boards || ''}
                onChange={(e) => setBoards(Number(e.target.value))}
              />
            </label>
            <label className="field">
              輪空 VP
              <input
                type="number"
                min={0}
                max={event.teamMethod === 'bam' ? 160000 : 20}
                step={0.01}
                value={byeVp}
                onChange={(e) => setByeVp(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="footnote">
            首圈依名單順序 1–2、3–4
            配對，奇數隊由最後一隊輪空；隔圈安排第二圈不依首圈成績，仍避免重複對手。後續輪空優先給輪空次數較少、累計
            VP 較低的隊伍。
          </p>
          {(playerBoardError(rounds, boards) || playerBoardWarning(rounds, boards)) && (
            <p role="alert">
              {playerBoardError(rounds, boards) || playerBoardWarning(rounds, boards)}
            </p>
          )}
          <button
            className="button subtle"
            disabled={
              busy ||
              locked ||
              !!Object.keys(event.results).length ||
              rounds < 1 ||
              boards < 1 ||
              boards > 16 ||
              !!playerBoardError(rounds, boards)
            }
            onClick={() =>
              void save({
                action: 'swiss-config',
                mode,
                rounds,
                boardsPerRound: boards,
                byeVp,
                reason: '設定 Swiss 逐圈配對',
              })
            }
          >
            設定 Swiss 並清除未收分賽程
          </button>
        </>
      ) : (
        <>
          <p>
            {event.swiss.mode === 'current' ? '當圈安排' : '隔圈安排'} · 已公布對戰不會自動重排。
          </p>
          {!!changed.length && (
            <p role="alert" className="alert error">
              已公布配對所依據的成績曾被更正（第{' '}
              {[...new Set(changed.map((p) => p.round))].join('、')}{' '}
              圈）。請裁判檢視操作紀錄；已公布對戰保持不變。
            </p>
          )}
          <div className="form-grid">
            <label className="field">
              編排圈次
              <select
                value={round}
                onChange={(e) => {
                  setRound(Number(e.target.value));
                  setPreview(null);
                  setError('');
                }}
              >
                {Array.from({ length: event.rounds }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    第 {i + 1} 圈{swissRoundComplete(event, i + 1) ? '（已完整公布）' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              公布方式
              <select
                value={partial ? 'partial' : 'full'}
                onChange={(e) => {
                  setPartial(e.target.value === 'partial');
                  setPreview(null);
                  setError('');
                }}
              >
                <option value="full">整圈配對</option>
                <option value="partial">保守分批公布</option>
              </select>
            </label>
          </div>
          <p className="footnote">
            分批只公布已收齊，且兩隊分數同時高於所有未收齊隊伍可能上限、或低於所有可能下限的對戰；同時保留剩餘隊伍可合法配對的方案。未收齊不視為
            0 VP，分批結果不保證與整圈收齊後完全相同。
          </p>
          <button
            className="button subtle"
            disabled={busy || locked}
            onClick={() => {
              try {
                setPreview(swissPreview(event, round, partial));
                setError('');
              } catch (e) {
                setError((e as Error).message);
                setPreview(null);
              }
            }}
          >
            預覽配對
          </button>
          {error && <p role="alert">{error}</p>}
          {preview && (
            <>
              <p>
                依據：
                {preview.sourceRound
                  ? `第 ${preview.sourceRound} 圈及之前成績`
                  : round === 1
                    ? '名單順序 1–2、3–4'
                    : '賽前同分配對（避免重複對手）'}{' '}
                · 本圈牌號 {boardRange(plannedBoards)}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>隊伍</th>
                      <th>對手</th>
                      <th>配對 VP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.pairs.map(([a, b]) => (
                      <tr key={a}>
                        <td>{name(a)}</td>
                        <td>{name(b)}</td>
                        <td>
                          {preview.scores.find((s) => s.id === a)!.score.toFixed(2)} /{' '}
                          {preview.scores.find((s) => s.id === b)!.score.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.bye && (
                <p>
                  輪空：{name(preview.bye)} · {event.byeVp ?? 12} VP
                  {preview.repeatedBye
                    ? '（無法為較少輪空的隊伍找到完整合法配對，這隊將再次輪空）'
                    : ''}
                </p>
              )}
              <p>
                {preview.remaining ? `尚有 ${preview.remaining} 隊等待配對。` : '本圈可完整公布。'}{' '}
                {!preview.pairs.length && !preview.bye ? '目前沒有可新增的對戰。' : ''}
              </p>
              <button
                className="button primary"
                disabled={busy || locked || (!preview.pairs.length && !preview.bye)}
                onClick={async () => {
                  if (
                    await save({
                      action: 'swiss-publish',
                      round,
                      partial,
                      reason: partial ? '保守分批公布 Swiss 對戰' : '公布 Swiss 整圈對戰',
                    })
                  )
                    setPreview(null);
                }}
              >
                確認公布以上對戰
              </button>
            </>
          )}
          {!!event.swiss.publications.length && (
            <>
              <button
                type="button"
                className="button secondary"
                aria-haspopup="dialog"
                onClick={() => setHistoryOpen(true)}
              >
                配對公布紀錄
              </button>
              {historyOpen && (
                <Modal title="配對公布紀錄" onClose={() => setHistoryOpen(false)}>
                  {event.swiss.publications.map((p, i) => (
                    <p key={i}>
                      第 {p.round} 圈 · 依據第 {p.sourceRound} 圈 · 版本 {p.sourceRevision} ·{' '}
                      {p.pairs.map(([a, b]) => `${name(a)} vs ${name(b)}`).join('；')}
                      {p.bye ? `；${name(p.bye)} 輪空` : ''}
                    </p>
                  ))}
                </Modal>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
