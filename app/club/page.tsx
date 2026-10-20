'use client';
import { PairDisplayName } from '@/components/pair-display-name';
import { MiniScoreReference } from '@/components/mini-score-reference';
import { DeclarerWarning, HcpFields, HcpSummary } from '@/components/hcp-fields';
import { useEffect, useRef, useState } from 'react';
import type { ClubView } from '@/lib/club-view';
import type { ResultInput } from '@/lib/model';
import { collectionScoreSide, collectionScoreLabel } from '@/lib/collection-score';
import { boardRange } from '@/lib/board-groups';
import { contractScore } from '@/lib/scoring';
import { MiniContractFields } from '@/components/mini-contract-fields';
import { createClubAutoFollow } from '@/lib/followed-participant';

const describeContract = (r: ResultInput) => r.level === 0 ? 'Pass' : `${r.level}${{ C: '♣', D: '♦', H: '♥', S: '♠', NT: 'NT' }[r.strain]}${r.doubled === 2 ? 'x' : r.doubled === 4 ? 'xx' : ''} ${r.declarer} · ${r.tricks} 墩${r.lead ? ` · 首引 ${r.lead.replace(/^[CDHS]/, suit => ({ C: '♣', D: '♦', H: '♥', S: '♠' })[suit as 'C'|'D'|'H'|'S']).replace(/T$/, '10')}` : ''}`;

export default function ClubPage() {
  const [data, setData] = useState<ClubView | null>(null);
  const [draft, setDraft] = useState<ResultInput | null>(null);
  const [draftRound, setDraftRound] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState('');
  const context = useRef({ id: '', token: '' });
  const submitting = useRef(false);
  const preview = useRef(false);
  const finished = useRef(false);
  const autoFollow = useRef(createClubAutoFollow((key, value) => localStorage.setItem(key, value)));
  async function read() {
    const { id, token } = context.current;
    const response = await fetch(`/api/club/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    autoFollow.current(body as ClubView);
    finished.current = body.status === 'finished';
    setData(body);
    return body as ClubView;
  }
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && new URLSearchParams(location.search).get('preview') === 'minibridge') {
      preview.current = true;
      void import('@/lib/mini-club-preview').then(({miniClubPreview}) => {
        const view = miniClubPreview(new URLSearchParams(location.search).get('mode') === 'pair'); setData(view); setDraftRound(view.round);
        const first = view.boards[0].result!; setDraft({...first, miniBridge:true});
      });
      return;
    }
    context.current = { id: new URLSearchParams(location.search).get('event') ?? '', token: location.hash.slice(1) };
    void read().catch(e => setError(e.message));
    const timer = setInterval(() => { if (!finished.current) void read().catch(e => setError(e.message)); }, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (data && draftRound !== data.round) setDraft(null); }, [data?.round, draftRound]);
  useEffect(() => { if ((data?.role !== 'input' && data?.role !== 'shared') || data?.locked || data?.finalized || draft && draft.assignmentId !== data?.assignment?.id) setDraft(null); }, [data?.role, data?.locked, data?.finalized, data?.assignment?.id, draft]);
  useEffect(() => { if (reviewing && reviewing !== data?.reviewVersion) setReviewing(''); }, [data?.reviewVersion, reviewing]);
  function edit(number: number) {
    if (!data?.assignment || (data.role !== 'input' && data.role !== 'shared') || data.locked) return;
    setReviewing('');
    const r = data.boards.find(b => b.number === number)?.result;
    setDraft(r ? { assignmentId: r.assignmentId, board: r.board, level: r.level, strain: r.strain, doubled: r.doubled, declarer: r.declarer, tricks: r.tricks, lead: r.lead, hcp: r.hcp, miniBridge: data.gameMode === 'minibridge' } : {
      assignmentId: data.assignment.id, board: number, level: 1, strain: 'C', doubled: 1, declarer: 'N', tricks: 7, lead: '', miniBridge: data.gameMode === 'minibridge',
    });
    setDraftRound(data.round);
    setNotice('');
  }
  async function submit(confirm: boolean) {
    if (!data || submitting.current) return;
    if (preview.current) {
      if (confirm) { setData({...data, accepted:true, locked:true}); setNotice('預覽：本圈已確認，未寫入賽事。'); }
      else if (draft) { setData({...data, boards:data.boards.map(b => b.number === draft.board ? {...b,result:{...draft,nsScore:contractScore(draft,'None',true),updatedAt:new Date().toISOString()}} : b)}); setDraft(null); }
      return;
    }
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/club/${encodeURIComponent(context.current.id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${context.current.token}` },
        body: JSON.stringify({ requestId: crypto.randomUUID(), round: confirm ? data.round : draftRound, confirm, ...(!confirm ? { result: draft } : { reviewVersion: data.mode === 'table' ? reviewing : data.reviewVersion }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setDraft(null);
      setReviewing('');
      setNotice(confirm ? '本桌本圈成績已認可，雙方均已鎖定。' : '成績已儲存。');
      await read();
    } catch (e) { setError((e as Error).message); await read().catch(() => {}); }
    finally { submitting.current = false; setBusy(false); }
  }
  const active = !!data && data.status === 'live' && !data.locked && !data.finalized && data.phase !== 'break' && data.round > 0;
  const editable = active && (data?.role === 'input' || data?.role === 'shared') && !reviewing;
  const board = data?.boards.find(b => b.number === draft?.board);
  const scoreSide = data ? collectionScoreSide(data, !!reviewing) : 'NS';
  const inputIsEW = !!data?.assignment && data.roles?.inputPair === data.assignment.ew;
  const missing = data?.boards.filter(b => !b.result).length ?? 0;
  const roleName = (id?: string) => id === data?.assignment?.ns
    ? data?.names?.ns || id
    : id === data?.assignment?.ew ? data?.names?.ew || id : id ?? '—';
  return <main className="club-page">
    <header className="club-page-heading">
      <span className="eyebrow">{data?.mode === 'table' ? 'TABLE SCORECARD' : 'CLUB SCORECARD · GUIDE CARD'}</span>
      <h1>{data?.deviceLabel ?? (data?.pairName ? <PairDisplayName name={data.pairName} /> : '裝置收分')}</h1>
      <div className="club-heading-meta">
      <p className="club-event-name">{data?.name}</p>
      <span className="club-heading-separator" aria-hidden="true">·</span>
      <nav className="club-heading-tools" aria-label="收分參考工具">
        <a href="/manual/players.html">收分操作手冊</a>
        {data?.gameMode === 'minibridge' && <><span aria-hidden="true">·</span><MiniScoreReference value={draft} inline /></>}
      </nav>
      </div>
    </header>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {!data ? <p>正在讀取專屬收分卡…</p> : <>
      {data.mode === 'table' && <p className="footnote">裝置留在本桌，換圈後自動載入本桌安排。請核對南北／東西與牌號，輸入完成後交給對方確認。</p>}
      {data.tableGuide && <section className="panel club-section" aria-label="本桌下一圈安排">
        {data.tableGuide.kind === 'table' ? <><h2>下一圈 · 第 {data.tableGuide.roundLabel} 圈</h2><p>{data.tableGuide.label} · 南北 <PairDisplayName name={data.tableGuide.ns} /> ／ 東西 <PairDisplayName name={data.tableGuide.ew} /></p><p>牌號：{boardRange(data.tableGuide.boards)}</p><p>裝置留在本桌，等待裁判開放下一圈。</p></> : data.tableGuide.kind === 'complete' ? <><h2>沒有下一圈</h2><p>請依裁判指示結束。</p></> : <><h2>等待本桌下一圈安排</h2><p>尚無可顯示的對戰，公布後會自動更新；無須將裝置帶走。</p></>}
      </section>}
      {data.guide && <section className="panel club-section" aria-label="下一圈 Guide card">
        <span className="eyebrow">GUIDE CARD</span>
        {data.guide.kind === 'table' ? <>
          <h2>第 {data.guide.round} 圈 · 前往第 {data.guide.table} 桌</h2>
          <p><strong>你的方向：{data.guide.direction === 'NS' ? '南北 NS' : '東西 EW'}</strong></p>
          <p>對手：<PairDisplayName name={data.guide.opponentName} />（{data.guide.opponentId.toUpperCase()}）</p>
          <p>牌號：{boardRange(data.guide.boards)}</p>
          <p className="footnote">{data.phase === 'break' ? '本圈已結束，請移動並確認對手與牌號是否正確' : '本圈尚未結束，請等待裁判指示移動'}</p>
        </> : data.guide.kind === 'bye' ? <>
          <h2>第 {data.guide.round} 圈輪空</h2><p>下一圈沒有對手與牌組，無需登分或確認。請依裁判指示休息。</p>
        </> : data.guide.kind === 'pending' ? <>
          <h2>等待裁判公布下一圈安排</h2><p>下一圈對手或桌次尚未確定，請先等候。安排公布後，這裡會自動更新入座資訊。</p>
        </> : <><h2>沒有下一圈</h2><p>本賽段賽程已到最後，請依裁判指示結束。</p></>}
      </section>}
      <section className="panel club-section">
        <h2>{data.deviceLabel ?? (data.assignment ? `第 ${data.assignment.table} 桌` : data.pair.toUpperCase())} · {data.round ? `第 ${data.roundLabel} 圈` : '尚未開始'}</h2>
        {data.assignment ? <>
          <div className="club-matchup" aria-label="本桌搭檔">
            {(['ns', 'ew'] as const).map(side => <div key={side}>
              <div className="club-matchup-name"><span className="club-seat-label">{side.toUpperCase()}</span><strong><PairDisplayName name={data.names?.[side]} /></strong></div>
              <small>{data.assignment![side].toUpperCase()} · {data.roles?.inputPair === data.assignment![side] ? '輸入方' : '確認方'}</small>
            </div>)}
          </div>
          <p className="club-entry-hint">{data.status === 'finished' ? '賽段已結束，成績已定案。' : data.status === 'review' ? '成績覆核中，如有疑義請向裁判提出更正。' : data.finalized ? '本圈已結算' : data.accepted ? '本桌成績已認可。若需更正，請聯絡裁判。' : data.phase === 'break' ? '圈間休息，暫停輸入與確認' : data.role === 'shared' ? reviewing ? '請由確認方核對上方全部成績，再確認鎖定。' : '請由指定方輸入，完成後將本裝置交給對方核對。' : data.role === 'input' ? '你是輸入方，請輸入全部成績，再由對方確認。' : '你是確認方，請核對全部成績；有誤請告知輸入方更正。'}</p>
          <div className="club-board-list">{data.boards.map(b => <div key={b.number} className="club-board-result">
            <strong>牌 {b.number}</strong><span>{!b.result ? '未收分' : b.result.status === 'cancelled' ? '取消' : b.result.split ? <>裁判不平衡合約：NS {describeContract(b.result.split.ns)} ／ EW {describeContract(b.result.split.ew)}</> : describeContract(b.result)}</span>
            {b.result && b.result.status !== 'cancelled' && <small>{collectionScoreLabel(b.result, scoreSide)}</small>}
            {b.result && <HcpSummary hcp={b.result.hcp} />}
            {(data.role === 'input' || data.role === 'shared') && <button className="button subtle" disabled={!editable || busy || b.result?.status === 'cancelled' || !!b.result?.split} title={draft?.board === b.number ? b.result ? '關閉更正介面' : '關閉輸入介面' : undefined} aria-expanded={draft?.board === b.number} aria-controls={draft?.board === b.number ? 'club-score-editor' : undefined} onClick={() => draft?.board === b.number ? setDraft(null) : edit(b.number)}>{draft?.board === b.number ? '關閉' : b.result ? '更正' : '輸入'}</button>}
          </div>)}</div>
          <p>輸入：<PairDisplayName name={roleName(data.roles?.inputPair)} /> ／ 確認：<PairDisplayName name={roleName(data.roles?.confirmPair)} /> · {data.accepted ? '已認可' : missing ? '待輸入完成' : '待對方確認'}</p>
        </> : <p>{data.round ? data.mode === 'table' ? '本桌本圈尚無可收分安排，請等待裁判。' : '本圈輪空，無需輸入或確認。' : '等待裁判指定目前圈數。'}</p>}
      </section>
      {draft && editable && <form id="club-score-editor" className="panel club-section" onSubmit={e => { e.preventDefault(); void submit(false); }}>
        <h2>牌 {draft.board} · {data.gameMode === 'minibridge' ? '迷你橋牌 · 無身價' : board?.vulnerability === 'All' ? '雙方有身價' : board?.vulnerability === 'None' ? '雙方無身價' : `${board?.vulnerability} 有身價`}</h2>
        <div className="form-grid">
          {data.gameMode === 'minibridge' ? <><HcpFields value={draft} onChange={setDraft} dealer={board?.dealer ?? 'N'} expected={board?.hcp} /><MiniContractFields value={draft} onChange={setDraft} /></> : <>
          <label className="field">線位<select value={draft.level} onChange={e => { const level = Number(e.target.value); setDraft({ ...draft, level, tricks: level ? level + 6 : 0, doubled: 1 }); }}>{Array.from({ length: 8 }, (_, n) => <option key={n} value={n}>{n || 'Pass'}</option>)}</select></label>
          <label className="field">合約花色<select disabled={!draft.level} value={draft.strain} onChange={e => setDraft({ ...draft, strain: e.target.value as ResultInput['strain'] })}>{['C','D','H','S','NT'].map((s,i) => <option key={s} value={s}>{['♣','♦','♥','♠','NT'][i]}</option>)}</select></label>
          </>}
          <label className="field">莊家<select disabled={!draft.level} value={draft.declarer} onChange={e => setDraft({ ...draft, declarer: e.target.value as ResultInput['declarer'] })}>{['N','E','S','W'].map(s => <option key={s}>{s}</option>)}</select></label>
          {data.gameMode !== 'minibridge' && <>
          <label className="field">賭倍<select disabled={!draft.level} value={draft.doubled} onChange={e => setDraft({ ...draft, doubled: Number(e.target.value) as 1|2|4 })}><option value={1}>無</option><option value={2}>x</option><option value={4}>xx</option></select></label>
          </>}
          <label className="field">實得墩數<select disabled={!draft.level} value={draft.tricks} onChange={e => setDraft({ ...draft, tricks: Number(e.target.value) })}>{Array.from({ length: 14 }, (_, n) => <option key={n} value={n}>{n}{draft.level ? `（${n - draft.level - 6 >= 0 ? '+' : ''}${n - draft.level - 6}）` : ''}</option>)}</select></label>
          <label className="field">首引（選填，如 S2）<input maxLength={4} value={draft.lead} onChange={e => setDraft({ ...draft, lead: e.target.value.toUpperCase() })} /></label>
        </div>
        <div className="score-preview club-score-preview"><span>合約與得分</span><strong>{describeContract(draft)}</strong><div className="score-preview-value">{inputIsEW ? 'EW' : 'NS'} 原始分 <b>{board ? (inputIsEW ? -1 : 1) * contractScore(draft, board.vulnerability, data.gameMode === 'minibridge') : '—'}</b></div>{data.gameMode === 'minibridge' && <DeclarerWarning value={draft} actualHcp={board?.hcp} dealer={board?.dealer ?? 'N'} />}</div>
        <div className="button-row"><button className="button primary" disabled={busy}>儲存這副成績</button><button type="button" className="button subtle" onClick={() => setDraft(null)}>關閉</button></div>
      </form>}
      {data.assignment && data.role === 'shared' && active && !reviewing && <section className="panel club-section"><h3>交給對方確認</h3><p>請交給 <PairDisplayName name={roleName(data.roles?.confirmPair)} /> 核對。此步驟是共用裝置上的交接，不是獨立登入驗證。</p><button className="button primary" disabled={busy || missing > 0 || !!draft} onClick={() => setReviewing(data.reviewVersion)}>全部輸入完成，交給對方核對</button></section>}
      {data.assignment && (data.role === 'confirm' || data.role === 'shared' && !!reviewing) && <section className="panel club-section"><h3>本圈確認</h3><p>請核對上方全部成績。確認後本桌成績獲認可，雙方均無法再修改。</p>
        {missing > 0 && <p role="status">尚缺 {missing} 副成績，等待輸入方補齊；未完成的牌請裁判處理。</p>}
        <button className="button primary" disabled={!active || busy || missing > 0} onClick={() => { if (window.confirm('已核對全部成績，確認並鎖定本桌本圈？')) void submit(true); }}>確認本桌本圈成績</button>
        {data.role === 'shared' && <button className="button subtle" disabled={busy} onClick={() => setReviewing('')}>有誤，返回更正</button>}
      </section>}
    </>}
  </main>;
}
