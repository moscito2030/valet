export function CompactImp({ text }: { text: string }) {
  const [whole, fraction] = text.split('.');
  return <span className="compact-imp" aria-label={text}><span aria-hidden="true">{whole}{fraction !== undefined && <><span className="compact-imp-separator">.</span><span className="compact-imp-fraction">{fraction}</span></>}</span></span>;
}
