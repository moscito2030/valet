import { pairTone } from './scoreboard-shared';

export function TeamImpColumns({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return <span className="team-imp-neutral muted" aria-label={value === null ? '尚未有可比較成績' : '平手，0 IMP'}>{value === null ? '待收分' : ''}</span>;
  }
  return <span className={`team-imp-columns mono ${pairTone(value, 0, 'butler')}`} aria-label={value > 0 ? `我方 ${value} IMP` : `對手 ${Math.abs(value)} IMP`}>
    <span>{value > 0 ? value : '—'}</span>
    <span>{value < 0 ? Math.abs(value) : '—'}</span>
  </span>;
}
