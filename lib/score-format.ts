/** Display-only formatting; never round values used by scoring calculations. */
export type ScoreUnit = '%' | 'IMP' | 'MP' | 'VP' | '';
export type ScoreFormat = {
  decimals?: number;
  signed?: boolean;
  unit?: ScoreUnit;
  showUnit?: boolean;
};
export function scoreParts(
  value: number | null | undefined,
  { decimals = 2, signed = false, unit = '', showUnit = true }: ScoreFormat = {},
) {
  if (value == null || !Number.isFinite(value)) return { number: '—', unit: '' };
  const rounded = Number(value.toFixed(decimals));
  return {
    number:
      (signed && rounded >= 0 ? '+' : '') +
      (Object.is(rounded, -0) ? 0 : rounded).toFixed(decimals),
    unit: showUnit ? unit : '',
  };
}
export function formatScore(value: number | null | undefined, options: ScoreFormat = {}) {
  const parts = scoreParts(value, options);
  return parts.number + (parts.unit ? ' ' + parts.unit : '');
}
export function pairScoreFormat(value: number | null | undefined, top: number, method = 'mp') {
  return {
    value: method === 'mp' ? (value != null && top > 0 ? (value / top) * 100 : null) : value,
    decimals: method === 'butler' ? 0 : 2,
    signed: method !== 'mp',
    unit: (method === 'mp' ? '%' : '') as ScoreUnit,
  };
}
