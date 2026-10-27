import { MiniScoreReference } from '@/components/mini-score-reference';
import type { ResultInput, Seat } from '@/lib/model';
import { dealHcp } from '@/lib/recorded-hcp';
import { resultKey } from '@/lib/model';
import { participantNumber } from '@/lib/participant-number';
import { contractScore } from '@/lib/scoring';
import { roundLabel } from '@/lib/team-movement';
import { Check } from 'lucide-react';
import { DeclarerWarning, HcpFields } from '../hcp-fields';
import { MiniContractFields } from '../mini-contract-fields';
import {
  AdminEvent,
  displayContract,
  number,
  resultText,
  seatNames,
  signed,
  suitSymbols,
  vulNames,
} from '../scoreboard-shared';
import { SplitContractEditor } from '../split-contract-editor';

type Props = {
  assignment: string;
  board: number;
  busy: boolean;
  event: AdminEvent;
  input: {
    assignmentId: string;
    board: number;
    level: number;
    strain: 'C' | 'D' | 'H' | 'S' | 'NT';
    doubled: 2 | 1 | 4;
    declarer: 'S' | 'N' | 'E' | 'W';
    tricks: number;
    lead: string;
    miniBridge?: boolean | undefined;
    hcp?:
      | {
          N?: number | undefined;
          E?: number | undefined;
          S?: number | undefined;
          W?: number | undefined;
        }
      | undefined;
  };
  reason: string;
  round: number;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
  setAssignment: React.Dispatch<React.SetStateAction<string>>;
  setBoard: React.Dispatch<React.SetStateAction<number>>;
  setInput: React.Dispatch<
    React.SetStateAction<{
      assignmentId: string;
      board: number;
      level: number;
      strain: 'C' | 'D' | 'H' | 'S' | 'NT';
      doubled: 2 | 1 | 4;
      declarer: 'S' | 'N' | 'E' | 'W';
      tricks: number;
      lead: string;
      miniBridge?: boolean | undefined;
      hcp?:
        | {
            N?: number | undefined;
            E?: number | undefined;
            S?: number | undefined;
            W?: number | undefined;
          }
        | undefined;
    }>
  >;
  setReason: React.Dispatch<React.SetStateAction<string>>;
  setRound: React.Dispatch<React.SetStateAction<number>>;
};
export function ScorePanel({
  assignment,
  board,
  busy,
  event,
  input,
  reason,
  round,
  save,
  setAssignment,
  setBoard,
  setInput,
  setReason,
  setRound,
}: Props) {
  const selected = event.assignments.find((a) => a.id === assignment),
    existing = event.results[resultKey(assignment, board)];
  const name = (id: string) => event.participants.find((p) => p.id === id)?.name ?? id;

  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (input.level < 0) return;
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
              ? event.knockout ? participantNumber(id, event.kind) : `${participantNumber(id, event.kind)} / ${score == null ? '—' : `${score >= 0 && method !== 'mp' ? '+' : ''}${number(score, method === 'butler' && Number.isInteger(score) ? 0 : 2)}${event.kind === 'teams' ? ' VP' : method === 'mp' ? '%' : ' IMP'}`}${standing ? ` / #${standing.rank}` : ''}`
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
                    <select name={`seat-${seat}`} defaultValue={selected.playerNames?.[seat] ?? ''}>
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
            <>
              <HcpFields
                value={input}
                onChange={setInput}
                dealer={event.boards.find((b) => b.number === board)?.dealer ?? 'N'}
              />
              <MiniContractFields value={input} onChange={setInput} />
            </>
          ) : (
            <>
              <label className="field">
                線位
                <select
                  required
                  value={input.level < 0 ? '' : input.level}
                  onChange={(e) => {
                    const level = Number(e.target.value);
                    setInput({ ...input, level, tricks: level ? level + 6 : 0, doubled: 1 });
                  }}
                >
                  <option value="" disabled>請選擇合約線位</option>
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
                  disabled={input.level <= 0}
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
            {event.gameMode === 'minibridge' && <DeclarerWarning value={input} actualHcp={dealHcp(event.boards.find(b => b.number === board)?.deal)} dealer={event.boards.find(b => b.number === board)?.dealer ?? 'N'} />}
            <span>NS 原始分</span>
            <strong>
              {input.level < 0 ? '—' : signed(
                contractScore(
                  input,
                  event.boards.find((b) => b.number === board)?.vulnerability ?? 'None',
                  event.gameMode === 'minibridge',
                ),
              )}
            </strong>
            <small>
              {vulNames[event.boards.find((b) => b.number === board)?.vulnerability ?? 'None']}
            </small>
          </div>
        </div>
        {event.gameMode === 'minibridge' && <MiniScoreReference value={input} />}
        <label className="field">
          {existing ? '更正原因（選填）' : '紀錄說明（選填）'}
          <input maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
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
              busy || input.level < 0 ||
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
            disabled={busy || event.status === 'finished' || !!existing?.split}
            onClick={() =>
              save({
                action: 'ruling',
                assignmentId: assignment,
                board,
                cancelled: existing?.status !== 'cancelled',
                reason,
              })
            }
          >
            {existing?.status === 'cancelled' ? '恢復取消前狀態' : '取消此副'}
          </button>
          {existing && (
            <button
              type="button"
              className="button danger"
              disabled={busy || event.status === 'finished' || !!existing.split || !!event.club?.finalized.includes(selected?.round ?? 0)}
              onClick={() => {
                if (!window.confirm('清除此桌第 ' + board + ' 副成績，回到未收分？合約、首引與大牌點將清除，本桌須重新輸入及確認。原紀錄保留於操作紀錄。')) return;
                void save({ action: 'clear-result', assignmentId: assignment, board, reason });
              }}
            >清除此副成績，回到未收分</button>
          )}
        </div>
        {existing && event.club?.finalized.includes(selected?.round ?? 0) && (
          <p className="footnote">本圈已結算，不開放清除單副成績。</p>
        )}
        {event.status === 'finished' && (
          <p className="footnote">賽段已結束，成績已定案，不再接受更正。</p>
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
            vulnerability={event.boards.find((b) => b.number === board)?.vulnerability ?? 'None'}
            miniBridge={event.gameMode === 'minibridge'}
            disabled={busy || event.status === 'finished'}
            save={save}
          />
        )}
    </>
  );
}
