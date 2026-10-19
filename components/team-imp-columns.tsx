import { pairTone } from './scoreboard-shared';

export function TeamImpColumns({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="team-imp-neutral muted" aria-label="尚未有可比較成績" />;
  }
  return <span className={`team-imp-columns mono ${pairTone(value, 0, 'butler')}`} aria-label={value === 0 ? '平手，0 IMP' : value > 0 ? `我方 ${value} IMP` : `對手 ${Math.abs(value)} IMP`}>
    <span className={value > 0 ? undefined : 'score-placeholder'}>{value > 0 ? value : '—'}</span>
    <span className={value < 0 ? undefined : 'score-placeholder'}>{value < 0 ? Math.abs(value) : '—'}</span>
  </span>;
}
