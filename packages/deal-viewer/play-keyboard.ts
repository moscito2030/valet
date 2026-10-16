export function cardKey(key: string, suit: string, legal: Iterable<string>): { suit: string; card?: string } {
  key = key.toUpperCase();
  if (/^[SHDC]$/.test(key)) return { suit: key };
  if (!/^[2-9TJQKA]$/.test(key)) return { suit: '' };
  const matches = [...legal].filter(card => card[1] === key && (!suit || card[0] === suit));
  return { suit: '', card: matches.length === 1 ? matches[0] : undefined };
}
