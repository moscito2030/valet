import { ParticipantsSetup } from '../participants-setup';
import { KnockoutPanel } from '../knockout-panel';
import {
  exportMovement,
  exportPbn,
  exportResultsCsv,
  parseByeVp,
  parseMovement,
  parsePbn,
  parseResultsCsv,
} from '@/lib/imports';
import { exportLineups, lineupRosterAdditions, parseLineups } from '@/lib/lineup-import';
import type { BridgeEvent } from '@/lib/model';
import { exportRosters, parseRosters } from '@/lib/roster-import';
import { exportRoundTimes, parseRoundTimes } from '@/lib/round-times-import';
import { isInterleaved, roundLabel, teamByes } from '@/lib/team-movement';
import { ArrowDownToLine } from 'lucide-react';
import { MovementPanel } from '../movement-panel';
import { RandomDealsPanel } from '../random-deals-panel';
import { AdminEvent, displayContract, download, resultText } from '../scoreboard-shared';
import { SwissPanel } from '../swiss-panel';

type Props = {
  busy: boolean;
  event: AdminEvent;
  importReason: string;
  importType: string;
  preview: string;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setImportReason: React.Dispatch<React.SetStateAction<string>>;
  setImportType: React.Dispatch<React.SetStateAction<string>>;
  setPreview: React.Dispatch<React.SetStateAction<string>>;
  setText: React.Dispatch<React.SetStateAction<string>>;
  text: string;
};
export function ImportPanel({
  busy,
  event,
  importReason,
  importType,
  preview,
  save,
  setError,
  setImportReason,
  setImportType,
  setPreview,
  setText,
  text,
}: Props) {
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
        const byes = teamByes({
          ...event,
          assignments: rows,
          byeVp: parseByeVp(text) ?? event.byeVp,
        });
        setPreview(
          `共 ${rows.length} 組桌次安排。${isInterleaved(rows) ? '交錯循環須完整匯入，已有成績後禁止重匯；每場依同一對戰的兩桌實際圈次比較。' : event.kind === 'teams' ? '僅更新所列圈次，未列出的圈次保持不變，已收分圈次不得改動。' : '首次匯入會取代尚未收分的預設賽程。'}${byes.length ? '\n輪空：' + byes.map((b) => `第 ${b.round} 圈 ${event.participants.find((p) => p.id === b.participantId)?.name}，${b.vp} VP`).join('；') : ''}`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      {event.canDirect && <ParticipantsSetup key={event.revision} event={event as BridgeEvent} busy={busy} save={save} />}
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
          0 表示不設上限，牌號持續遞增；設定正整數則超過後從牌號 1 重新顯示。各圈成績仍獨立保存。
        </p>
        <button className="button subtle" disabled={busy}>
          儲存最大牌號
        </button>
      </form>
      <KnockoutPanel
        key={`knockout-${event.id}-${event.revision}`}
        event={event as BridgeEvent}
        busy={busy}
        save={save}
      />
      {!event.knockout && (
        <SwissPanel
          key={`swiss-${event.id}-${event.revision}`}
          event={event as BridgeEvent}
          busy={busy}
          save={save}
        />
      )}
      {!event.swiss && !event.knockout && (
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
                    : `可先匯出賽程再修改，逐圈匯入時每圈須包含完整賽程；已收分的圈次不可更改，已結束賽段不可更改。${event.kind === 'teams' ? '一般隊制賽填 room：open／closed，同桌兩室方向相反、牌組相同。交錯循環另填 matchId 配對跨圈兩桌，須在收分前一次匯入完整賽程。奇數隊輪空可附 byeVp，預設 12。' : ''}`}
        </p>
      </section>
      <section className="import-export-section">
        <h4>匯出資料</h4>
        <p>下載目前賽事的成績、賽程或牌型。</p>
        <div className="button-row export-row">
          {event.kind === 'teams' && (
            <button
              className="button subtle"
              onClick={() => download(event.id + '-rosters.csv', exportRosters(event), 'text/csv')}
            >
              <ArrowDownToLine size={16} />
              隊伍賽員名單 CSV
            </button>
          )}
          {event.kind === 'teams' && (
            <button
              className="button subtle"
              onClick={() => download(`${event.id}-lineups.csv`, exportLineups(event), 'text/csv')}
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
              download(`${event.id}-movement.csv`, exportMovement(event as BridgeEvent), 'text/csv')
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
  );
}
