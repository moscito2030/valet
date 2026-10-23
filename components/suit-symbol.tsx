const symbols: Record<string, [string, string]> = {
  S: ['♠', '♤'], H: ['♥', '♡'], D: ['♦', '♢'], C: ['♣', '♧'],
};

/** Switch presentation in CSS while retaining one accessible suit label. */
export function SuitSymbol({ suit, label }: { suit: string; label?: string }) {
  const pair = symbols[suit];
  if (!pair) return <>{suit}</>;
  return <span className="suit-symbol" aria-label={label ?? pair[0]} role="img">
    <span className="suit-symbol-solid" aria-hidden="true">{pair[0] + '\uFE0E'}</span>
    <span className="suit-symbol-outline" aria-hidden="true">{pair[1]}</span>
  </span>;
}
