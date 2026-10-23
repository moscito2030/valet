import { scoreParts, pairScoreFormat, type ScoreFormat } from '@/lib/score-format';
import { CompactImp } from './compact-imp';
export function ScoreValue({
  value,
  compact = true,
  ...options
}: ScoreFormat & { value: number | null | undefined; compact?: boolean }) {
  const parts = scoreParts(value, options);
  return (
    <span className="score-value" aria-label={parts.number + (parts.unit ? ' ' + parts.unit : '')}>
      <span aria-hidden="true">
        {compact ? <CompactImp text={parts.number} /> : parts.number}
        {parts.unit && <span className="score-unit">{parts.unit}</span>}
      </span>
    </span>
  );
}
export function PairScoreValue({
  value,
  top,
  method = 'mp',
}: {
  value: number | null | undefined;
  top: number;
  method?: string;
}) {
  return <ScoreValue {...pairScoreFormat(value, top, method)} />;
}
