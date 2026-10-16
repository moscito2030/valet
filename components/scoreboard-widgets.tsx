'use client';
import type { PublicEvent, Seat } from '@/lib/model';
import { Activity, LockKeyhole } from 'lucide-react';
import { hasDeal, seatNames, suitSymbols } from './scoreboard-shared';
export function Stat({
  label,
  value,
  suffix,
  icon,
  progress,
  popoverTarget,
  onClick,
  detail,
}: {
  label: string;
  value: number | string;
  suffix: string;
  icon?: React.ReactNode;
  progress?: number;
  popoverTarget?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  detail?: string;
}) {
  const content = (
    <>
      <div className="stat-top">
        <span>{label}</span>
        {icon ?? <Activity size={18} />}
      </div>
      <div className="stat-value">
        {value}
        <small>{suffix}</small>
        {detail && <span className="stat-detail">{detail}</span>}
      </div>
      {progress !== undefined && (
        <div className="progress-track">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </>
  );
  return popoverTarget ? (
    <button className="stat-card interactive-stat" popoverTarget={popoverTarget} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat-card">{content}</div>
  );
}
export function RoundSelect({
  count,
  round,
  setRound,
}: {
  count: number;
  round: number;
  setRound: (n: number) => void;
}) {
  return (
    <label className="round-select">
      圈次{' '}
      <select
        aria-label="選擇圈次"
        value={round}
        onChange={(e) => setRound(Number(e.target.value))}
      >
        {Array.from({ length: count }, (_, i) => (
          <option key={i} value={i + 1}>
            第 {i + 1} 圈
          </option>
        ))}
      </select>
    </label>
  );
}
export function DealDiagram({ board }: { board: PublicEvent['boards'][number] }) {
  if (!hasDeal(board) || board.deal.N.length !== 13)
    return (
      <div className="hidden-deal">
        <LockKeyhole size={32} />
        <strong>{'deal' in board ? '尚未匯入牌型' : '牌型尚未公開'}</strong>
        <span>逐副合約與成績可在下方的單副成績表查詢。</span>
      </div>
    );
  return (
    <div className="deal-diagram">
      {(['N', 'W', 'E', 'S'] as Seat[]).map((seat) => (
        <div className={`hand hand-${seat}`} key={seat}>
          <div className="seat-label">
            {seat} <span>{seatNames[seat]}</span>
          </div>
          {['S', 'H', 'D', 'C'].map((s) => (
            <div className="suit-line" key={s}>
              <b className={s === 'H' || s === 'D' ? 'red' : ''}>{suitSymbols[s]}</b>
              <span>
                {board.deal[seat]
                  .filter((c) => c[0] === s)
                  .map((c) => c[1])
                  .sort((a, b) => 'AKQJT98765432'.indexOf(a) - 'AKQJT98765432'.indexOf(b))
                  .join(' ') || '—'}
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="deal-center">
        <span>BOARD</span>
        <strong>{board.number}</strong>
        <small>{board.dealer} DEALER</small>
      </div>
    </div>
  );
}
