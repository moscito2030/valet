const suits = {
  s: { symbol: '♠', label: '黑桃', red: false },
  h: { symbol: '♥', label: '紅心', red: true },
  d: { symbol: '♦', label: '方塊', red: true },
  c: { symbol: '♣', label: '梅花', red: false },
} as const;

/** Render shorthand as React text nodes, never interpret user content as HTML. */
export function CommentText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(![shdc])/gi).map((part, index) => {
        const suit = /^![shdc]$/i.test(part)
          ? suits[part[1].toLowerCase() as keyof typeof suits]
          : undefined;
        return suit ? (
          <span
            key={index}
            className={`discussion-suit${suit.red ? ' discussion-suit-red' : ''}`}
            role="img"
            aria-label={suit.label}
          >
            {suit.symbol}
          </span>
        ) : (
          part
        );
      })}
    </>
  );
}
