import { ArrangementPanel } from './ArrangementPanel';
import { PairNames } from '../pair-names';
import { TeamScoringSettings } from '../team-scoring-settings';
import { awardPlacesFor, hasDirectionalAwards } from '@/lib/awards';
import { boardGroups, boardRange } from '@/lib/board-groups';

import { AdminEvent, api } from '../scoreboard-shared';

type Props = {
  section?: 'information' | 'boards' | 'all';
  busy: boolean;
  deleteName: string;
  event: AdminEvent;
  eventId: string;
  onDeleted: () => Promise<void>;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setDeleteName: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
};
export function PublicationPanel({
  section = 'all',
  busy,
  deleteName,
  event,
  eventId,
  onDeleted,
  save,
  setBusy,
  setDeleteName,
  setError,
}: Props) {
  return (
    <>
      {section !== 'boards' && <>
      <TeamScoringSettings event={event} busy={busy} save={save} />
      {event.canDirect && <form className="import-export-section" onSubmit={(e) => {
        e.preventDefault();
        void save({ action: 'settings', status: event.status, audienceRefreshSeconds: Number(new FormData(e.currentTarget).get('audienceRefreshSeconds')), reason: '設定觀眾端刷新頻率' });
      }}>
        <h4>觀眾端自動更新</h4>
        <label className="field">基本刷新間隔
          <select name="audienceRefreshSeconds" key={event.audienceRefreshSeconds ?? 30} defaultValue={event.audienceRefreshSeconds ?? 30} disabled={busy}>
            {[15, 30, 60, 120].map(seconds => <option key={seconds} value={seconds}>{seconds} 秒{seconds === 30 ? '（預設）' : ''}</option>)}
          </select>
        </label>
        <p className="footnote">套用於此賽段的觀眾計分版；背景分頁暫停更新，連線失敗時延長間隔，賽段結束後停止。已開啟的頁面會在下次更新後套用。</p>
        <button className="button subtle" disabled={busy}>儲存刷新間隔</button>
      </form>}

      {event.canDirect && (
        <form
          className="event-identity-form"
          key={`${event.stageName}-${event.date}-${event.endDate}-${event.venueOverride}`}
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void save({
              action: 'settings',
              status: event.status,
              stageName: String(form.get('name')),
              venueOverride: String(form.get('venueOverride') ?? '').trim() || null,
              date: String(form.get('date')),
              endDate: String(form.get('endDate')) || null,
              reason: '修改賽段資訊',
            });
          }}
        >
          <h4>賽段資訊</h4>
          <label className="field">
            賽段名稱
            <input
              name="name"
              minLength={1}
              maxLength={80}
              required
              defaultValue={event.stageName ?? event.name}
            />
          </label>
          <label className="field">
            開始日期
            <input name="date" type="date" required defaultValue={event.date} />
          </label>
          <label className="field">
            結束日期（選填）
            <input name="endDate" type="date" defaultValue={event.endDate ?? ''} />
          </label>
          <p className="footnote">單日賽段可將結束日期留空。</p>
<label className="field">
            賽段地點
            <input
              name="venueOverride"
              maxLength={80}
              defaultValue={event.venueOverride ?? ''}
              placeholder="留空沿用賽事地點"
            />
          </label>
          <p className="footnote">留空時沿用賽事地點：{event.competition?.venue || '未公布'}。</p>
          <button className="button subtle" disabled={busy}>
            儲存賽段資訊
          </button>
        </form>
      )}
      <p className="footnote">
        賽事名稱、前綴與共用地點，請至{' '}
        <a
          href={`/?competition=${encodeURIComponent(event.competition?.id ?? event.parentEventId ?? event.id)}`}
        >
          賽事主頁
        </a>{' '}
        編輯。
      </p>
      {event.canDirect && event.kind === 'pairs' && event.participants.length > 0 && (
        <PairNames participants={event.participants} busy={busy} save={save} />
      )}
      </>}
      {section !== 'information' && event.canDirect && (
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
      {section !== 'boards' && <>
      <form
        className="setting-row event-description-settings"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void save({
            action: 'settings',
            status: event.status,
            ...(hasDirectionalAwards(event) ? { awardPlacesNS: Number(form.get('awardPlacesNS')), awardPlacesEW: Number(form.get('awardPlacesEW')) } : { awardPlaces: Number(form.get('awardPlaces')) }),
            awardDescription: String(form.get('awardDescription') ?? ''),
            winAward: { enabled: form.get('winAwardEnabled') === 'true', win: Number(form.get('winAwardWin')), loss: Number(form.get('winAwardLoss')), draw: Number(form.get('winAwardDraw')) },
            movementDescription: String(form.get('movementDescription') ?? ''),
            reason: '設定給獎與賽程說明',
          });
        }}
      >
        {(hasDirectionalAwards(event) ? ['NS', 'EW'] : ['']).map(side => (
          <label className="field" key={side}>
            {side && side + ' '}給獎至第幾名（0 表示不給獎）
            <input key={awardPlacesFor(event, side)} name={'awardPlaces' + side} type="number" min="0" max="32" required defaultValue={awardPlacesFor(event, side)} />
          </label>
        ))}
        <label className="field">
          勝場獎統計
          <select name="winAwardEnabled" key={String(event.winAward?.enabled)} defaultValue={String(event.winAward?.enabled ?? false)}>
            <option value="false">關閉</option><option value="true">開啟</option>
          </select>
        </label>
        <div className="form-grid">
          {([['Win', '勝', event.winAward?.win ?? 2], ['Draw', '和', event.winAward?.draw ?? 1], ['Loss', '負', event.winAward?.loss ?? 0]] as const).map(([key, label, value]) => (
            <label className="field" key={key}>每{label}一圈的獎勵倍數
              <input key={value} name={'winAward' + key} type="number" min="0" max="10000" step="any" required defaultValue={value} />
            </label>
          ))}
        </div>
        <p className="footnote">勝場獎與總排名無關。例：勝／和／負設為 2／1／0，或 2／0／0。</p>
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
      </>}
      {section !== 'information' && event.canDirect && (
        <section className="import-export-section" aria-label="賽段管理">
          <h3>賽段管理</h3>
          <h4>封存賽段</h4>
          <p>{event.stageArchived ? '此賽段已封存，僅裁判可見。' : '封存後僅裁判可見，觀眾、賽務與收分裝置無法存取；不影響同賽事其他賽段。'}</p>
          <button type="button" className="button subtle" disabled={busy} onClick={() => {
            if (!event.stageArchived && !window.confirm('封存此賽段？觀眾、賽務與收分裝置將無法存取，裁判可隨時解除封存。')) return;
            void save({action:'stage-archive', archived:!event.stageArchived, reason:event.stageArchived ? '解除封存賽段' : '封存賽段'});
          }}>{event.stageArchived ? '解除封存賽段' : '封存賽段'}</button>
          <h4>清除所有成績</h4>
          <p>清除全部成績、判罰扣分、收分確認與結算狀態，回到尚未開始收分；保留賽程、入座名單、牌型與操作紀錄。</p>
          <ArrangementPanel busy={busy} event={event} save={save} />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api(`/api/admin/events/${eventId}`, {
                method: 'DELETE',
                body: JSON.stringify({ confirmStageName: deleteName, revision: event.revision }),
              });
              await onDeleted();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h4>刪除賽段</h4>
          <p>
            永久刪除此賽段的賽程、成績與操作紀錄，賽事共用資訊仍會保留。請輸入完整賽段名稱「
            {event.stageName ?? event.name}」確認。
          </p>
          <label className="field">
            確認賽段名稱
            <input
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="button primary"
            disabled={busy || deleteName !== (event.stageName ?? event.name)}
          >
            永久刪除賽段
          </button>
        </form>
        </section>
      )}
    </>
  );
}
