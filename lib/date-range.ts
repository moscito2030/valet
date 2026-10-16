export type DateRange = { date: string; endDate?: string | null };

export function dateRangeLabel(range: DateRange): string {
  return range.endDate && range.endDate !== range.date
    ? `${range.date} ～ ${range.endDate}`
    : range.date;
}

export function includesDate(range: DateRange, date: string): boolean {
  return range.date <= date && date <= (range.endDate || range.date);
}

// Enumerate months, not every day, for the calendar's month selector.
export function dateRangeMonths(ranges: DateRange[]): string[] {
  const months = new Set<string>();
  for (const range of ranges) {
    const [year, month] = range.date.split('-').map(Number);
    const [endYear, endMonth] = (range.endDate || range.date).split('-').map(Number);
    for (let i = year * 12 + month - 1; i <= endYear * 12 + endMonth - 1; i++)
      months.add(`${String(Math.floor(i / 12)).padStart(4, '0')}-${String(i % 12 + 1).padStart(2, '0')}`);
  }
  return [...months].sort();
}
