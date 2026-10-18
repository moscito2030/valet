'use client';
import { MAX_PLAYER_BOARDS, playerBoardError, playerBoardWarning } from '@/lib/schedule-limits';
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
  const [plannedRounds, setPlannedRounds] = useState(0);
  const [plannedBoards, setPlannedBoards] = useState<number | null>(null);
  const count = plannedBoards ?? (kind === 'teams' ? 8 : 2);
  const [method, setMethod] = useState('mp');
  const [movementPlan, setMovementPlan] = useState('');
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
      const lines = (field: string) => String(form.get(field) ?? '').split('\n').map(s => s.trim()).filter(Boolean);
      const grouped = kind === 'pairs' && !!movementPlan;
      if (grouped && lines('nsNames').length !== lines('ewNames').length) throw new Error('NS 與 EW 組需有相同搭檔數');
      const stage = {
        kind,
        gameMode,
        ...(grouped ? { movementPlan } : {}),
        pairMethod: kind === 'pairs' ? method : 'mp',
        trim: kind === 'pairs' && method !== 'mp' ? form.get('trim') : 'none',
        name: form.get('name'),
        prefix: competition ? '' : form.get('prefix'),
        date: form.get('date'),
        ...(form.get('endDate') ? { endDate: form.get('endDate') } : {}),
        venue: competition?.venue ?? form.get('venue'),
        ...(!competition && staged ? { firstStageName: form.get('firstStageName') } : {}),
        rounds: form.get('rounds') ? Number(form.get('rounds')) : undefined,
        boardsPerRound: form.get('boardsPerRound') ? Number(form.get('boardsPerRound')) : undefined,
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
            {competition.name} · {competition.venue || '未填地點'}
            <br />
            此賽段使用獨立日期、名單、賽制與成績。
          </p>
        )}
        {(playerBoardError(plannedRounds, count) || playerBoardWarning(plannedRounds, count)) && <p role="alert">{playerBoardError(plannedRounds, count) || playerBoardWarning(plannedRounds, count)}</p>}
        <div className="segmented">
          <button
            type="button"
            className={kind === 'teams' ? 'selected' : ''}
            onClick={() => (setKind('teams'), setPlannedBoards(null))}
          >
            隊制賽 · IMP / VP
          </button>
          <button
            type="button"
            className={kind === 'pairs' ? 'selected' : ''}
            onClick={() => (setKind('pairs'), setPlannedBoards(null))}
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
          <label className="field">
            圈數（選填）
            <input name="rounds" type="number" min={1} max={MAX_PLAYER_BOARDS} onChange={e => setPlannedRounds(Number(e.target.value))} placeholder="稍後設定" />
          </label>
          <label className="field">
            每圈牌數
            <input
              name="boardsPerRound"
              onChange={e => setPlannedBoards(Number(e.target.value))}
              type="number"
              min={1}
              max={16}
              defaultValue={kind === 'teams' ? 8 : 2}
              key={kind}
            />
          </label>
          <p className="footnote create-details-help">圈數可留空，稍後設定賽程；每圈牌數也可稍後調整。</p>
        </div>
        {kind === 'pairs' && <label className="field">排名與編排
          <select value={movementPlan} onChange={e => setMovementPlan(e.target.value)}>
            <option value="">合併排名 · 全場同牌輪轉</option>
            <option value="double-mitchell">Double Winner Mitchell／Skip Mitchell</option>
            <option value="double-mitchell-relay">Double Winner Mitchell（偶數桌共牌／中繼）</option>
          </select>
          <span className="footnote">雙冠軍支援 3–19 桌。奇數桌最多桌數圈；Skip Mitchell 最多桌數減一圈；共牌／中繼最多桌數圈。每圈最多 16 副，總牌數依編排計算。</span>
        </label>}
        {kind === 'pairs' && movementPlan ? <div className="form-grid">
          {(['NS', 'EW'] as const).map(group => <label className="field" key={group}>{group} 組搭檔（一行一組，3–19 組）
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
        <p className="footnote">圈數留空時僅建立名單，請至裁判「匯入／匯出」設定賽程編排後再開始收分。</p>
        <p className="footnote">
          {kind === 'teams' ? '預設為兩室循環對戰；奇數隊每圈一隊輪空，預設 12 VP。隊數可被 3 或 5 整除時可採交錯循環，請在收分前至裁判「匯入／匯出」選擇，並可設定輪空 VP。' : kind === 'pairs' && movementPlan ? 'NS 固定、EW 依編排移動，各組獨立排名、同分並列。請在圈次與對戰中確認牌組流向；偶數桌共牌／中繼需安排共牌或複製牌。' : '預設建立固定循環對戰，各桌每圈打相同牌組。雙人賽需備妥重複牌組，或在收分前匯入自己的賽程編排。排名同分並列。'}
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
