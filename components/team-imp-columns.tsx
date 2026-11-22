import { pairTone, signed } from './scoreboard-shared';
import type { ReactNode } from 'react';

export function TeamImpColumns({ value, awarded, renderSide }: { value: number | null; awarded?: [number, number]; renderSide?: (content: ReactNode, side: number) => ReactNode }) {
  if (awarded) return (
    <span className="team-imp-columns mono" aria-label={`我方 ${signed(awarded[0])} IMP，對手 ${signed(awarded[1])} IMP`}>
      {awarded.map((score, side) => (
        <span key={side}>{renderSide ? renderSide(signed(score), side) : signed(score)}</span>
      ))}
    </span>
  );
  if (value === null) {
    return <span className="team-imp-neutral muted" aria-label="尚未有可比較成績" />;
  }
  return <span className={`team-imp-columns mono ${pairTone(value, 0, 'butler')}`} aria-label={value === 0 ? '平手，0 IMP' : value > 0 ? `我方 ${value} IMP` : `對手 ${Math.abs(value)} IMP`}>
    {[value > 0 ? value : null, value < 0 ? Math.abs(value) : null].map((score, side) => {
      const content = <span className={score === null ? 'score-placeholder' : undefined}>{score ?? '—'}</span>;
      return renderSide ? <span key={side}>{renderSide(content, side)}</span> : <span key={side} className={score === null ? 'score-placeholder' : undefined}>{score ?? '—'}</span>;
    })}
  </span>;
}
