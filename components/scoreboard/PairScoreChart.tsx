'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicEvent } from '@/lib/model';
import { pairScoreHistory, usesCommonBoards } from '@/lib/pair-score-history';

export function PairScoreChart({ event, person }: { event: PublicEvent; person: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [availableWidth, setAvailableWidth] = useState(360);
  const scroller = useRef<HTMLDivElement>(null);
  const commonBoards = usesCommonBoards(event);
  const points = pairScoreHistory(event, person);
  const valid = points.filter(p => p.close !== null);
  const hasScores = valid.length > 0;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [commonBoards, hasScores]);
  if (!commonBoards) return null;
  const mp = (event.pairMethod ?? 'mp') === 'mp';
  const unit = mp ? '%' : ' IMP';
  const format = (v: number) => `${v.toFixed(2)}${unit}`;
  const active = points.find(p => p.board === selected) ?? valid.at(-1);
  const base = mp ? 50 : 0;
  const min = Math.min(base, ...valid.flatMap(p => [p.open, p.low!]));
  const max = Math.max(base, ...valid.flatMap(p => [p.open, p.high!]));
  const padding = Math.max((max - min) * .12, mp ? 5 : 1);
  const bottom = min - padding, top = max + padding;
  const width = Math.max(availableWidth, points.length * 28 + 64);
  const y = (v: number) => 20 + (top - v) / (top - bottom) * 180;
  const step = (width - 64) / Math.max(1, points.length);
  const ticks = [top, (top + bottom) / 2, bottom];
  return <section className="pair-score-chart" aria-label="逐副累積成績 K 棒">
    <div className="pair-score-chart-heading">
      <h3>累積{mp ? ' MP%' : ' IMP'}</h3>
      <span className="muted">全場共牌 · 依牌號</span>
    </div>
    <p className="footnote">實體為前後累積分；影線為本副全場同方向成績的累積變動範圍。未收分、取消牌不計入，未扣罰分。</p>
    {!valid.length ? <p className="empty compact">尚無可計分成績</p> : <>
      <div className="pair-score-chart-scroll" ref={scroller}>
        <svg viewBox={`0 0 ${width} 235`} width={width} height="235" role="group" aria-label="點選各副 K 棒查看分數">
          {ticks.map(tick => <g key={tick}>
            <line x1="50" x2={width - 10} y1={y(tick)} y2={y(tick)} className="pair-chart-grid" />
            <text x="44" y={y(tick) + 4} textAnchor="end" className="pair-chart-label">{tick.toFixed(1)}</text>
          </g>)}
          <line x1="50" x2={width - 10} y1={y(base)} y2={y(base)} className="pair-chart-baseline" />
          {points.map((p, i) => {
            const x = 50 + step * (i + .5);
            const label = `牌 ${p.board}：${p.close === null ? p.cancelled ? '取消' : '未有可計分成績' : `${format(p.open)} → ${format(p.close)}，範圍 ${format(p.low!)} 至 ${format(p.high!)}${p.provisional ? '，暫計' : ''}`}`;
            return <g key={p.board} className={`pair-chart-candle ${p.close === null || p.close === p.open ? 'flat' : p.close > p.open ? 'gain' : 'loss'}${active?.board === p.board ? ' selected' : ''}`}
              role="button" tabIndex={0} aria-label={label} aria-pressed={active?.board === p.board}
              onClick={() => setSelected(p.board)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p.board); } }}>
              <title>{label}</title>
              <rect x={x - step / 2} y="14" width={step} height="210" className="pair-chart-hit" rx="4" />
              {p.close !== null ? <>
                <line x1={x} x2={x} y1={y(p.high!)} y2={y(p.low!)} className="pair-chart-wick" />
                <rect x={x - 6} y={Math.min(y(p.open), y(p.close)) - (p.close === p.open ? 1 : 0)}
                  width="12" height={Math.max(2, Math.abs(y(p.open) - y(p.close)))} rx="1"
                  className={`pair-chart-body${p.provisional ? ' provisional' : ''}`} />
              </> : <text x={x} y={y(p.open)} textAnchor="middle" className="pair-chart-label">·</text>}
              <text x={x} y="224" textAnchor="middle" className="pair-chart-label">{p.board}</text>
            </g>;
          })}
        </svg>
      </div>
      <div className="pair-chart-detail" aria-live="polite">
        {active && <><strong>牌 {active.board}</strong><span>{active.close === null ? active.cancelled ? '取消牌' : '未有可計分成績' : `${format(active.open)} → ${format(active.close)}`}</span>
          {active.close !== null && <span className="muted">範圍 {format(active.low!)} ～ {format(active.high!)}{active.provisional ? ' · 暫計' : ''}</span>}</>}
      </div>
    </>}
  </section>;
}
