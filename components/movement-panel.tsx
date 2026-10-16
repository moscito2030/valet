'use client';
import { useState } from 'react';
import type { BridgeEvent } from '@/lib/model';
import { buildMovement, movementOptions } from '@/lib/movement-plans';

export function MovementPanel({ event, busy, save }: {
  event: Pick<BridgeEvent, 'kind' | 'participants' | 'rounds' | 'boardsPerRound' | 'boards' | 'results' | 'status' | 'byeVp'>;
  busy: boolean; save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [choice, setChoice] = useState('');
  const [preview, setPreview] = useState(false);
  const [rounds, setRounds] = useState(event.rounds || 3);
  const [boardsPerRound, setBoardsPerRound] = useState(event.boardsPerRound || (event.kind === 'teams' ? 8 : 2));
  const [byeVp, setByeVp] = useState(event.byeVp ?? 12);
  const draft = { ...event, rounds, boardsPerRound, byeVp };
  const options = movementOptions(draft);
  const plan = options.some(p => p.id === choice) ? buildMovement(draft, choice) : null;
  const locked = event.status === 'finished' || Object.keys(event.results).length > 0;
  const name = (id: string) => event.participants.find(p => p.id === id)?.name ?? id;
  return <section className="import-export-section">
    <h4>指定賽程編排</h4>
    <p>{event.participants.length} {event.kind === 'teams' ? '隊' : '對'} · {event.rounds ? `目前 ${event.rounds} 圈，每圈 ${event.boardsPerRound} 牌` : '待設定賽程'}</p>
    <div className="form-grid">
      <label className="field">圈數<input type="number" min={1} max={event.kind === 'teams' ? 31 : 19} value={rounds || ''} disabled={locked} onChange={e => { setRounds(Number(e.target.value)); setPreview(false); }} /></label>
      <label className="field">每圈牌數<input type="number" min={1} max={32} value={boardsPerRound || ''} disabled={locked} onChange={e => { setBoardsPerRound(Number(e.target.value)); setPreview(false); }} /></label>
    </div>
    {event.kind === 'teams' && [3, 5].includes(event.participants.length) && <p className="footnote">全員打牌的交錯循環：三隊請設 2 圈，五隊請設 4 圈；每圈牌數也是每場對戰的比較牌數。</p>}
    <label className="field">適用的編排方式<select value={choice} disabled={locked} onChange={e => { setChoice(e.target.value); setPreview(false); }}>
      <option value="">請選擇賽程編排</option>
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select></label>
    <p className="footnote">依本賽段人數、圈數列出適用選項。{event.kind === 'pairs' && '3/4 Howell 的圈數依編排表而定，並非固定為完整 Howell 的四分之三。'}</p>
    {plan && <>
      <p>{plan.option.note}</p>
      {plan.byes.length > 0 && <label className="field">輪空 VP（每圈，0–20）<input type="number" min={0} max={20} step={0.01} value={byeVp} disabled={locked} onChange={e => { setByeVp(Number(e.target.value)); setPreview(false); }} /><span className="footnote">該圈收分完成後計入排名；不計 IMP、實打牌數或個人統計。</span></label>}
      {choice.startsWith('double-') && <div className="form-grid">
        {(['NS', 'EW'] as const).map(group => <div key={group}><strong>{group} 組</strong><p>{plan.participants.filter(p => p.group === group).map(p => p.name).join('、')}</p></div>)}
      </div>}
      <p>共 {plan.option.groups} 組牌、{plan.boardCount} 副。{plan.byes.length ? '每圈有一隊輪空。' : event.kind === 'pairs' && event.participants.length % 2 ? '每圈有一對輪空。' : ''}不共牌需準備 {plan.copies} 套完整牌，每套 {plan.boardCount} 副，共 {plan.copies * plan.boardCount} 副實體牌。{plan.shared ? '各套相同牌號的牌型須一致；也可安排共牌。' : ''}</p>
      {plan.boardCount !== event.boards.length && <p className="footnote">套用後牌數將由 {event.boards.length} 改為 {plan.boardCount}；保留相同牌號的牌型，移除範圍外的牌號。</p>}
      <button className="button subtle" onClick={() => setPreview(!preview)}>{preview ? '收起預覽' : '預覽完整賽程'}</button>
      {preview && <>
        <div className="table-scroll"><table><thead><tr><th>圈次</th><th>桌號／室</th><th>南北</th><th>東西</th><th>牌號</th></tr></thead><tbody>
          {plan.assignments.map(a => <tr key={a.id}><td>{a.round}</td><td>{a.table}{event.kind === 'teams' && choice !== 'team-interleaved' ? `／${a.room === 'open' ? '開' : '閉'}` : ''}</td><td>{name(a.ns)}</td><td>{name(a.ew)}</td><td>{a.boards.join(', ')}</td></tr>)}
        </tbody></table></div>
        {plan.byes.length > 0 && <ul>{plan.byes.map(bye => <li key={bye.round}>第 {bye.round} 圈：{name(bye.participantId)} 輪空，{bye.vp} VP</li>)}</ul>}
        <p className="footnote">確認後將替換本賽段賽程、清除原圈次時間，並重設為尚未開始。已有成績時不能套用。</p>
        <button className="button subtle" disabled={busy || locked} onClick={async () => {
          if (await save({ action: 'movement-plan', plan: choice, rounds, boardsPerRound, ...(plan.byes.length ? { byeVp } : {}), reason: `指定 ${plan.option.label}` })) setPreview(false);
        }}>確認套用賽程編排</button>
      </>}
      {plan.option.source && <p className="footnote"><a href={plan.option.source} target="_blank" rel="noreferrer">查看編排表來源</a></p>}
    </>}
  </section>;
}
