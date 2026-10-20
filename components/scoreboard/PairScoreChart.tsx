'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicEvent } from '@/lib/model';
import { pairScoreHistory, roundMovingAverage, usesCommonBoards } from '@/lib/pair-score-history';

export function PairScoreChart({ event, person, hoveredBoard = null }: { event: PublicEvent; person: string; hoveredBoard?: number | null }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
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
  const highlighted = hovered ?? hoveredBoard ?? focused;
  const active = points.find(p => p.board === (highlighted ?? selected)) ?? valid.at(-1);
  const latest = valid.at(-1);
  const base = mp ? 50 : 0;
  const min = Math.min(base, ...valid.flatMap(p => [p.open, p.low!]));
  const max = Math.max(base, ...valid.flatMap(p => [p.open, p.high!]));
  const radius = 2 * Math.ceil(Math.max(mp ? 5 : 2, Math.max(base - min, max - base) * 1.12) / 2);
  const bottom = base - radius, top = base + radius;
  const width = Math.max(120, availableWidth);
  const y = (v: number) => 20 + (top - v) / (top - bottom) * 180;
  const left = 12, right = width - 64;
  const step = (right - left) / Math.max(1, points.length);
  const roundMA = roundMovingAverage(points, event.boardsPerRound);
  const maPath = roundMA.map((value, index) => value === null ? '' :
    `${index === 0 || roundMA[index - 1] === null ? 'M' : 'L'}${left + step * (index + .5)},${y(value)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(28 / step));
  const ticks = [top, base + radius / 2, base, base - radius / 2, bottom];
  const activeX = active ? left + step * (points.indexOf(active) + .5) : null;
  const tone = active?.close == null || active.close === active.open ? 'flat' : active.close > active.open ? 'gain' : 'loss';
  return <section className="panel pair-score-chart" aria-label="逐副累積成績 K 棒">
    <div className="pair-score-chart-heading">
      <div><h3>累積{mp ? ' MP%' : ' IMP'}</h3><p>全場共牌 <span aria-hidden="true">·</span> 逐副走勢</p></div>
      {latest && <div className="pair-chart-latest"><strong>{latest.close!.toFixed(2)}<small>{mp ? '%' : ' IMP'}</small></strong><span>截至牌 {latest.board}{latest.provisional ? ' · 暫計' : ''}</span></div>}
    </div>
    {!valid.length ? <p className="empty compact">尚無可計分成績</p> : <>
      <div className={`pair-chart-detail ${tone}`} aria-live="polite">
        {active && <>
          <div className="pair-chart-board"><strong>牌 {active.board}</strong><span>{active.cancelled ? '取消 · 不計分' : active.close === null ? '待收分' : active.provisional ? '暫計' : `第 ${active.round} 圈`}</span></div>
          <dl>{([
            ['前值', active.open], ['本副後', active.close], ['全場低', active.low], ['全場高', active.high],
          ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === null ? '—' : value.toFixed(2)}</dd></div>)}</dl>
        </>}
      </div>
      <div className="pair-score-chart-scroll" ref={scroller} onMouseLeave={() => setHovered(null)}>
        <svg viewBox={`0 0 ${width} 235`} width={width} height="235" role="group" aria-label="點選各副 K 棒查看分數">
          {ticks.map(tick => <g key={tick}>
            <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="pair-chart-grid" />
            <text x={right + 12} y={y(tick) + 4} className="pair-chart-label pair-chart-tick">{tick}</text>
          </g>)}
          <line x1={right} x2={right} y1="14" y2="205" className="pair-chart-axis" />
          <line x1={left} x2={right} y1="205" y2="205" className="pair-chart-axis" />
          <line x1={left} x2={right} y1={y(base)} y2={y(base)} className="pair-chart-baseline" />
          {points.map((p, i) => {
            const x = left + step * (i + .5);
            const label = `牌 ${p.board}：${p.close === null ? '未有可計分成績' : `${p.cancelled ? '取消牌，不計入累積，' : ''}${format(p.open)} → ${format(p.close)}，範圍 ${format(p.low!)} 至 ${format(p.high!)}${p.provisional ? '，暫計' : ''}`}`;
            return <g key={p.board} className={`pair-chart-candle ${p.close === null || p.close === p.open ? 'flat' : p.close > p.open ? 'gain' : 'loss'}${highlighted === p.board ? ' selected' : ''}`}
              role="button" tabIndex={0} aria-label={label} aria-pressed={selected === p.board}
              onClick={() => setSelected(p.board)}
              onMouseEnter={() => setHovered(p.board)}
              onFocus={e => { if (e.currentTarget.matches(':focus-visible')) setFocused(p.board); }}
              onBlur={() => setFocused(null)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(p.board); } }}>
              <title>{label}</title>
              <rect x={x - step / 2} y="14" width={step} height="210" className="pair-chart-hit" rx="4" />
              {p.close !== null ? <>
                <line x1={x} x2={x} y1={y(p.high!)} y2={y(p.low!)} className="pair-chart-wick" />
                <rect x={x - step / 2} y={Math.min(y(p.open), y(p.close)) - (p.close === p.open ? 1 : 0)}
                  width={step} height={Math.max(2, Math.abs(y(p.open) - y(p.close)))}
                  className={`pair-chart-body${p.provisional ? ' provisional' : ''}`} />
              </> : <text x={x} y={y(p.open)} textAnchor="middle" className="pair-chart-label">·</text>}
              {i % labelEvery === 0 && <text x={x} y="224" textAnchor="middle" className="pair-chart-label">{p.board}</text>}
            </g>;
          })}
          <path d={maPath} className="pair-chart-round-ma" aria-label={`round MA：最近 ${event.boardsPerRound} 副收盤值的平均`} />
          {highlighted !== null && active && activeX !== null && <g className={`pair-chart-crosshair ${tone}`} aria-hidden="true">
            <line x1={activeX} x2={activeX} y1="14" y2="205" />
            {active.close !== null && <>
              <line x1={left} x2={right} y1={y(active.close)} y2={y(active.close)} />
              <circle cx={activeX} cy={y(active.close)} r="3" />
            </>}
            <rect x={Math.max(left, Math.min(right - 30, activeX - 15))} y="210" width="30" height="21" rx="4" />
            <text x={Math.max(left + 15, Math.min(right - 15, activeX))} y="224" textAnchor="middle">{active.board}</text>
          </g>}
          <text x={right + 12} y="224" className="pair-chart-label">牌號</text>
        </svg>
      </div>
      <div className="pair-chart-footer">
        <div className="pair-chart-legend"><span><i className="gain" />上升</span><span><i className="loss" />下降</span><span><i className="flat" />持平／取消</span><span title={`最近 ${event.boardsPerRound} 副收盤值的平均；滿一圈後顯示`}><i className="round-ma" />round MA</span></div>
        <span>滑過或點選查看</span>
      </div>
      <p className="pair-chart-notes">實體為前後累積分；影線為本副全場同方向成績的累積變動範圍。{mp ? 'MP% 依累計所得 MP 與累計滿分計算。' : 'IMP 逐副累加。'}未收分、取消牌不計入累積，未扣罰分。取消牌保留影線，暫計棒以淡色虛線呈現。</p>
    </>}
  </section>;
}
