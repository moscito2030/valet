import { Fragment } from 'react';

/** Preserve spaces within names; normalize only explicit pair separators. */
export function PairDisplayName({ name }: { name?: string | null }) {
  const names = (name ?? '').split(/\s*[/／]\s*/).map(part => part.trim()).filter(Boolean);
  return <>{names.map((part, index) => <Fragment key={index}>{index > 0 && <span className="pair-name-separator"> · </span>}{part}</Fragment>)}</>;
}
