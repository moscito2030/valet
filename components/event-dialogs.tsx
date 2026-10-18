'use client';
import type { Kind } from '@/lib/model';
import { Info, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { EventCalendar } from './event-calendar';
import { api } from './scoreboard-shared';
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="關閉" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function CreateCompetitionDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="建立賽事" onClose={onClose}><form onSubmit={async e => {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
    try {
      const result = await api<{ id: string }>('/api/competitions', { method: 'POST', body: JSON.stringify({ name: form.get('name'), prefix: form.get('prefix'), venue: form.get('venue') }) });
      await onCreated(result.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }}>
    <p>先保存賽事共用資訊，之後再新增賽段、名單與賽程。</p>
    <label className="field">賽事名稱<input name="name" required minLength={2} maxLength={80} /></label>
    <label className="field">前綴（選填）<input name="prefix" maxLength={80} /></label>
    <label className="field">共用地點（選填）<input name="venue" maxLength={80} /></label>
    <p className="footnote">各賽段預設沿用共用地點，也可另設地點。</p>
    {error && <p className="error-text" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy}>{busy ? '建立中…' : '建立賽事'}</button>
  </form></Modal>;
}

export function CreateDialog({
  onClose,
  onCreated,
  competition,
}: {
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
  competition?: import('@/lib/model').CompetitionInfo;
}) {
  const [kind, setKind] = useState<Kind>('teams'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [method, setMethod] = useState('mp');
  const [rankingMode, setRankingMode] = useState<'single' | 'double'>('single');
  const [gameMode, setGameMode] = useState<'bridge' | 'minibridge'>('bridge');
  const [eventDate, setEventDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
  );
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    setError('');
    try {
      const lines = (field: string) => String(form.get(field) ?? '').split('\n').map(s => s.trim()).filter(Boolean);
      const grouped = kind === 'pairs' && rankingMode === 'double';
      if (grouped && lines('nsNames').length !== lines('ewNames').length) throw new Error('NS 與 EW 組需有相同搭檔數');
      const stage = {
        kind,
        gameMode,
        ...(kind === 'pairs' ? { rankingMode } : {}),
        pairMethod: kind === 'pairs' ? method : 'mp',
        trim: kind === 'pairs' && method !== 'mp' ? form.get('trim') : 'none',
        name: form.get('name'),
        prefix: competition ? '' : form.get('prefix'),
        date: form.get('date'),
        ...(form.get('endDate') ? { endDate: form.get('endDate') } : {}),
        venue: competition?.venue ?? form.get('venue'),
        ...(competition && String(form.get('venueOverride') ?? '').trim() ? { venueOverride: String(form.get('venueOverride')).trim() } : {}),
        names: grouped ? [...lines('nsNames'), ...lines('ewNames')] : lines('names'),
      };
      const res = await api<{ id: string }>(
        competition ? `/api/competitions/${competition.id}/stages` : '/api/events',
        {
          method: 'POST',
          body: JSON.stringify(
            competition
              ? {
                  stage,
                  revision: competition.revision,
                }
              : stage,
          ),
        },
      );
      await onCreated(res.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={competition ? '新增賽段' : '建立新賽事'} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          橋牌模式
          <select
            value={gameMode}
            onChange={(e) => setGameMode(e.target.value as 'bridge' | 'minibridge')}
          >
            <option value="bridge">一般橋牌</option>
            <option value="minibridge">迷你橋牌</option>
          </select>
        </label>
        {gameMode === 'minibridge' && <p>五種花色 × 一線／成局，共 10 種合約；無身價、不加倍。</p>}
        {competition && (
          <p>
            {competition.name} · {competition.venue || '未填地點'}
            <br />
            此賽段使用獨立日期、名單、賽制與成績。
          </p>
        )}
        <div className="segmented">
          <button
            type="button"
            className={kind === 'teams' ? 'selected' : ''}
            onClick={() => setKind('teams')}
          >
            隊制賽 · IMP / VP
          </button>
          <button
            type="button"
            className={kind === 'pairs' ? 'selected' : ''}
            onClick={() => setKind('pairs')}
          >
            雙人賽
          </button>
        </div>
        {kind === 'pairs' && (
          <div className="form-grid">
            <div className="field">
              <div className="scoring-label">
                <label htmlFor="create-scoring-mode">計分模式</label>
                <button
                  type="button"
                  className="scoring-info-button"
                  aria-label="計分模式說明"
                  popoverTarget="create-scoring-help"
                >
                  <Info size={16} />
                </button>
              </div>
              <select
                id="create-scoring-mode"
                aria-label="計分模式"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="mp">MP 百分比</option>
                <option value="crossimp">CrossIMP</option>
                <option value="butler">ButlerIMP</option>
              </select>
            </div>
            <label className="field">
              <span className="scoring-label">去頭去尾</span>
              <select name="trim" disabled={method === 'mp'} defaultValue="none">
                <option value="none">不去除</option>
                <option value="one">最高、最低各去一筆</option>
                <option value="ten-percent">最高、最低各去 10%（向下取整）</option>
              </select>
            </label>
            <div
              id="create-scoring-help"
              popover="auto"
              className="scoring-help"
              role="dialog"
              aria-label="計分模式說明"
            >
              <div className="scoring-help-heading">
                <strong>計分模式說明</strong>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="關閉計分模式說明"
                  popoverTarget="create-scoring-help"
                  popoverTargetAction="hide"
                >
                  <X size={16} />
                </button>
              </div>
              <p>
                <strong>MP：</strong>比較各桌成績，以百分比計分。
              </p>
              <p>
                <strong>Butler：</strong>樣本算術平均取最近 10 分（恰為 5
                時遠離零），各桌與此基準分比較 IMP。
              </p>
              <p>
                <strong>CrossIMP：</strong>每桌對其他桌的 IMP 取平均。
              </p>
              <p>
                去尾僅影響比較樣本，所有有效桌次仍計分；樣本少於三筆不去尾。IMP 排名採累計總分。
              </p>
            </div>
          </div>
        )}
        <label className="field">
          {competition ? '新賽段名稱' : '賽事名稱（不含前綴）'}
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="例如：秋季俱樂部邀請賽"
          />
        </label>
        {!competition && (
          <label className="field">
            比賽前綴（選填）
            <input name="prefix" maxLength={80} placeholder="例如：臺灣大學橋藝社 114-1" />
          </label>
        )}
        <div className="form-grid create-details-grid">
          <div className="field">
            <span>開始日期</span>
            <input name="date" type="hidden" value={eventDate} />
            <EventCalendar dates={[]} value={eventDate} onChange={setEventDate} unrestricted />
          </div>
          <label className="field">
            結束日期（選填）
            <input name="endDate" type="date" min={eventDate} aria-describedby="create-date-help" />
          </label>
          <p className="footnote create-details-help" id="create-date-help">單日比賽只需填開始日期。</p>
          {!competition && (
            <label className="field create-details-wide">
              地點
              <input name="venue" maxLength={80} placeholder="比賽地點" />
            </label>
          )}
          {competition && <div className="field create-details-wide">
            <input aria-label="賽段地點" name="venueOverride" maxLength={80} placeholder="留空沿用賽事地點" />
            <span className="footnote">留空時沿用賽事地點：{competition.venue || '未公布'}</span>
          </div>}
        </div>
        {kind === 'pairs' && <label className="field">排名方式
          <select value={rankingMode} onChange={e => setRankingMode(e.target.value as 'single' | 'double')}>
            <option value="single">Single Winner（合併排名）</option>
            <option value="double">Double Winner（NS／EW 分別排名）</option>
          </select>
          <span className="footnote">建立後再至裁判「賽程編排與牌局管理 → 指定賽程編排」選擇具體編排、圈數與每圈牌數。</span>
        </label>}
        {kind === 'pairs' && rankingMode === 'double' ? <div className="form-grid">
          {(['NS', 'EW'] as const).map(group => <label className="field" key={group}>{group} 組搭檔（一行一組，3–32 組）
            <textarea name={group === 'NS' ? 'nsNames' : 'ewNames'} rows={5} required />
          </label>)}
        </div> : <label className="field">
          {kind === 'teams' ? '隊伍名稱（一行一隊，至少三隊）' : '搭檔名稱（一行一對，至少四對）'}
          <textarea
            name="names"
            rows={5}
            required
            placeholder={
              kind === 'teams'
                ? '臺北隊\n新竹隊\n臺中隊\n高雄隊'
                : '林冠宇 / 陳思妤\n張哲維 / 王品涵\n李柏翰 / 黃詠晴\n吳承恩 / 劉芷瑜'
            }
          />
        </label>}
        <p className="footnote">
          先建立賽段與名單，不產生牌號或桌次；進入賽段後至裁判「賽程編排與牌局管理 → 指定賽程編排」，一起設定圈數、每圈牌數與編排，預覽並套用後才能開始收分。
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? '建立中…' : competition ? '建立賽段' : '建立賽事'}
        </button>
      </form>
    </Modal>
  );
}
