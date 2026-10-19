'use client';
import { useState } from 'react';
import type { BridgeEvent } from '@/lib/model';
import type { KnockoutNode, KnockoutSource } from '@/lib/knockout-schema';
import { knockoutScore, seedKnockout, validateKnockout } from '@/lib/knockout';
import { availableKnockoutOutputs, newKnockoutPlacement } from '@/lib/knockout';
import { project } from '@/lib/scoring';
import { Modal } from './event-dialogs';
export function KnockoutPanel({
  event,
  busy,
  save,
}: {
  event: BridgeEvent;
  busy: boolean;
  save: (p: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [nodes, setNodes] = useState<KnockoutNode[]>(event.knockout?.nodes ?? []);
  const [seeds, setSeeds] = useState(event.participants.map((p) => p.id));
  const [legs, setLegs] = useState(1),
    [boards, setBoards] = useState(8),
    [bronze, setBronze] = useState('yes');
  const [editing, setEditing] = useState<string | null>(null),
    [reason, setReason] = useState(''),
    [winners, setWinners] = useState<Record<string, string>>({});
  if (event.kind !== 'teams' || event.swiss) return null;
  const locked =
    Object.keys(event.results).length > 0 ||
    !!(event.knockout && Object.keys(event.knockout.published).length) ||
    event.status === 'finished';
  const node = nodes.find((n) => n.id === editing),
    index = node ? nodes.indexOf(node) : -1;
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;
  const patch = (value: Partial<KnockoutNode>) =>
    setNodes(nodes.map((n) => (n.id === editing ? { ...n, ...value } : n)));
  const encode = (s: KnockoutSource) => (s.kind === 'bye' ? 'bye' : s.kind + ':' + s.id);
  const decode = (s: string): KnockoutSource =>
    s === 'bye'
      ? { kind: 'bye' }
      : { kind: s.split(':')[0] as 'team' | 'winner' | 'loser', id: s.split(':')[1] };
  const sourceName = (s: KnockoutSource) =>
    s.kind === 'bye'
      ? '輪空'
      : s.kind === 'team'
        ? name(s.id)
        : (nodes.find((n) => n.id === s.id)?.name ?? s.id) +
          (s.kind === 'winner' ? ' 勝方' : ' 敗方');
  const outputs = availableKnockoutOutputs(nodes);
  const projection = project(event);
  let validation = '',
    maxBoards = 0;
  if (nodes.length)
    try {
      maxBoards = validateKnockout(nodes, event);
    } catch (error) {
      validation = error instanceof Error ? error.message : '對戰表設定不完整';
    }
  return (
    <section className="import-export-section">
      <h4>隊制淘汰賽與排名賽</h4>
      <p>先安排完整對戰表，再公布已確定雙方的對局。種子順序由高至低；後續來源可指定勝方或敗方。</p>
      {!locked && (
        <>
          <div className="form-grid">
            <label className="field">
              預設每對局圈數
              <input
                type="number"
                min="1"
                max="1024"
                value={legs}
                onChange={(e) => setLegs(Number(e.target.value))}
              />
            </label>
            <label className="field">
              預設每圈牌數
              <input
                type="number"
                min="1"
                max="16"
                value={boards}
                onChange={(e) => setBoards(Number(e.target.value))}
              />
            </label>
            <label className="field">
              初始排名賽
              <select value={bronze} onChange={(e) => setBronze(e.target.value)}>
                <option value="yes">先加入銅牌戰（至少四隊，可再新增其他排名賽）</option>
                <option value="no">不加入</option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            {seeds.map((id, i) => (
              <label className="field" key={i}>
                種子 {i + 1}
                <select
                  value={id}
                  onChange={(e) => {
                    const next = [...seeds],
                      j = next.indexOf(e.target.value);
                    [next[i], next[j]] = [next[j], next[i]];
                    setSeeds(next);
                  }}
                >
                  {event.participants.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={busy || legs < 1 || boards < 1 || boards > 16}
            onClick={() => setNodes(seedKnockout(seeds, legs, boards, bronze === 'yes'))}
          >
            產生種子對戰表草稿
          </button>
        </>
      )}
      {validation && <p role="alert">{validation}</p>}
      {maxBoards > 512 && (
        <p role="alert">
          此對戰表的最長參賽路徑為 {maxBoards} 牌，超過 512 牌；請確認賽程長度（上限 1024
          牌，輪空也計入）。
        </p>
      )}
      {nodes.map((n) => (
        <div className="setting-row" key={n.id}>
          <div>
            <strong>{n.name}</strong>
            <p>
              {sourceName(n.a)} 對 {sourceName(n.b)}
            </p>
            <p>
              第 {n.startRound} 圈起 · {n.rounds} 圈 × {n.boardsPerRound} 牌 · 第 {n.table} 桌
            </p>
          </div>
          {!locked && (
            <button type="button" className="button subtle" onClick={() => setEditing(n.id)}>
              編輯對局
            </button>
          )}
        </div>
      ))}
      <p className="footnote">
        排名賽不限銅牌戰：可讓八強敗隊接到第 5–8 名賽，再將其勝方與敗方分別接到第 5／6 名及第 7／8
        名賽。請在公布對戰前安排完成，僅在最後一場填最終名次。
      </p>
      {!locked && !!nodes.length && (
        <div className="form-grid">
          <button
            type="button"
            className="button secondary"
            disabled={busy || outputs.length < 2 || legs < 1 || boards < 1 || boards > 16}
            onClick={() => {
              const next = newKnockoutPlacement(nodes, legs, boards);
              setNodes([...nodes, next]);
              setEditing(next.id);
            }}
          >
            新增排名賽（可接任一輪勝／敗方）
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy || !!validation}
            onClick={() =>
              void save({ action: 'knockout-config', nodes, reason: '設定淘汰賽與順位賽對戰表' })
            }
          >
            儲存完整對戰表
          </button>
        </div>
      )}
      {node && !locked && (
        <Modal title={'編輯 ' + node.name} onClose={() => setEditing(null)}>
          <label className="field">
            對局名稱
            <input
              value={node.name}
              maxLength={80}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          {(['a', 'b'] as const).map((side) => (
            <label className="field" key={side}>
              {side === 'a' ? 'A 方' : 'B 方'}來源
              <select
                value={encode(node[side])}
                onChange={(e) => patch({ [side]: decode(e.target.value) })}
              >
                <option value="bye">輪空</option>
                {event.participants.map((p) => (
                  <option key={p.id} value={'team:' + p.id}>
                    {p.name}
                  </option>
                ))}
                {nodes.slice(0, index).flatMap((n) => [
                  <option key={n.id + 'w'} value={'winner:' + n.id}>
                    {n.name} 勝方
                  </option>,
                  <option key={n.id + 'l'} value={'loser:' + n.id}>
                    {n.name} 敗方
                  </option>,
                ])}
              </select>
            </label>
          ))}
          <div className="form-grid">
            {(
              [
                ['startRound', '開始圈次', 1024],
                ['rounds', '對局圈數', 1024],
                ['boardsPerRound', '每圈牌數', 16],
                ['table', '桌號', 32],
              ] as const
            ).map(([key, label, max]) => (
              <label className="field" key={key}>
                {label}
                <input
                  type="number"
                  min="1"
                  max={max}
                  value={node[key]}
                  onChange={(e) => patch({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
            {(['winnerPlace', 'loserPlace'] as const).map((key) => (
              <label className="field" key={key}>
                {key === 'winnerPlace' ? '勝方' : '敗方'}最終名次
                <input
                  type="number"
                  min="1"
                  max={event.participants.length}
                  value={node[key] ?? ''}
                  placeholder="留空：尚非最終名次"
                  onChange={(e) =>
                    patch({ [key]: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
              </label>
            ))}
          </div>
          <p className="footnote">
            後續對局開始圈次必須晚於來源對局的最後一圈。名次只填於最終順位對局。
          </p>
          <button
            type="button"
            className="button subtle"
            onClick={() => {
              setNodes(nodes.filter((n) => n.id !== node.id));
              setEditing(null);
            }}
          >
            移除此對局
          </button>
          <button type="button" className="button primary" onClick={() => setEditing(null)}>
            完成草稿編輯
          </button>
        </Modal>
      )}
      {event.knockout && (
        <>
          <button
            type="button"
            className="button primary"
            disabled={busy || event.status === 'finished'}
            onClick={() =>
              void save({ action: 'knockout-publish', reason: '公布已確定雙方的淘汰賽對局' })
            }
          >
            公布已確定雙方的對局
          </button>
          <label className="field">
            決勝／撤回原因
            <input
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="平手指定晉級或撤回勝負時必填"
            />
          </label>
          {event.knockout.nodes
            .filter((n) => event.knockout!.published[n.id]?.b)
            .map((n) => {
              const p = event.knockout!.published[n.id],
                d = event.knockout!.decisions[n.id],
                score = knockoutScore(event, n, projection);
              return (
                <div className="setting-row" key={n.id}>
                  <div>
                    <strong>
                      {n.name} · {name(p.a)} vs {name(p.b!)}
                    </strong>
                    <p>
                      {score.a.toFixed(2)}：{score.b.toFixed(2)}{' '}
                      {event.teamMethod === 'bam' ? 'VP' : 'IMP'} ·{' '}
                      {d ? '已確認勝方 ' + name(d.winner) : score.complete ? '已收齊' : '未收齊'}
                    </p>
                  </div>
                  {d ? (
                    <button
                      type="button"
                      className="button subtle"
                      disabled={busy || event.status === 'finished' || reason.trim().length < 2}
                      onClick={() => void save({ action: 'knockout-reopen', nodeId: n.id, reason })}
                    >
                      撤回勝負與後續安排
                    </button>
                  ) : (
                    <div>
                      {score.tied && (
                        <label className="field">
                          平手晉級隊伍
                          <select
                            value={winners[n.id] ?? ''}
                            onChange={(e) => setWinners({ ...winners, [n.id]: e.target.value })}
                          >
                            <option value="">請選擇</option>
                            <option value={p.a}>{name(p.a)}</option>
                            <option value={p.b!}>{name(p.b!)}</option>
                          </select>
                        </label>
                      )}
                      <button
                        type="button"
                        className="button primary"
                        disabled={
                          busy ||
                          event.status === 'finished' ||
                          !score.complete ||
                          (score.tied && (!winners[n.id] || reason.trim().length < 2))
                        }
                        onClick={() =>
                          void save({
                            action: 'knockout-decide',
                            nodeId: n.id,
                            ...(score.tied ? { winner: winners[n.id] } : {}),
                            reason: reason.trim() || '確認淘汰賽累計成績勝方',
                          })
                        }
                      >
                        確認勝負
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </>
      )}
    </section>
  );
}
