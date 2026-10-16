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
  const [gameMode, setGameMode] = useState<'bridge' | 'minibridge'>('bridge');
  const [staged, setStaged] = useState(false);
  const [eventDate, setEventDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
  );
  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    setError('');
    try {
      const stage = {
        kind,
        gameMode,
        pairMethod: kind === 'pairs' ? method : 'mp',
        trim: kind === 'pairs' && method !== 'mp' ? form.get('trim') : 'none',
        name: form.get('name'),
        prefix: competition ? '' : form.get('prefix'),
        date: competition?.date ?? form.get('date'),
        venue: competition?.venue ?? form.get('venue'),
        ...(!competition && staged ? { firstStageName: form.get('firstStageName') } : {}),
        rounds: Number(form.get('rounds')),
        boardsPerRound: Number(form.get('boardsPerRound')),
        names: String(form.get('names'))
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
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
                  ...(!competition.hasStages ? { firstStageName: form.get('firstStageName') } : {}),
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
            <option value="minibridge">MiniBridge 迷你橋牌</option>
          </select>
        </label>
        {gameMode === 'minibridge' && <p>五種花色 × 一線／成局，共 10 種合約；無身價、不加倍。</p>}
        {!competition && (
          <label className="stage-mode">
            <input type="checkbox" checked={staged} onChange={(e) => setStaged(e.target.checked)} />{' '}
            設立賽段
          </label>
        )}
        {((!competition && staged) || (competition && !competition.hasStages)) && (
          <label className="field">
            {competition ? '原有成績的賽段名稱' : '第一賽段名稱'}
            <input name="firstStageName" required maxLength={80} placeholder="例如：預賽" />
          </label>
        )}
        {competition && (
          <p>
            {competition.name} · {competition.date} · {competition.venue || '未填地點'}
            <br />
            此賽段使用獨立名單、賽制與成績。
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
          {!competition && (
            <>
              <div className="field">
                <span>日期</span>
                <input name="date" type="hidden" value={eventDate} />
                <EventCalendar dates={[]} value={eventDate} onChange={setEventDate} unrestricted />
              </div>
              <label className="field">
                地點
                <input name="venue" maxLength={80} placeholder="比賽地點" />
              </label>
            </>
          )}
          <label className="field">
            圈數
            <input name="rounds" type="number" min={1} max={15} defaultValue={3} required />
          </label>
          <label className="field">
            每圈牌數
            <input
              name="boardsPerRound"
              type="number"
              min={1}
              max={32}
              defaultValue={kind === 'teams' ? 8 : 2}
              key={kind}
              required
            />
          </label>
        </div>
        <label className="field">
          {kind === 'teams' ? '隊伍名稱' : '搭檔名稱'}（一行一組，至少四組）
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
        </label>
        <p className="footnote">
          預設建立固定循環對戰，各桌每圈打相同牌組。雙人賽需備妥重複牌組，或在收分前匯入自己的賽程編排。排名同分並列。
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? '建立中…' : competition ? '建立賽段與賽程' : '建立賽事與賽程'}
        </button>
      </form>
    </Modal>
  );
}
