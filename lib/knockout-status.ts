import type { BridgeEvent } from './model';

export function isImpKnockout(
  event: Pick<BridgeEvent, 'teamMethod'> & Partial<Pick<BridgeEvent, 'knockout' | 'teamFormat'>>,
) {
  return (!!event.knockout || event.teamFormat === 'knockout') && event.teamMethod !== 'bam';
}

/** A walkover settles a match, but never creates scores for unplayed boards. */
export function knockoutExemptAssignments(
  event: Pick<BridgeEvent, 'assignments'> & Partial<Pick<BridgeEvent, 'knockout'>>,
) {
  const ids = new Set<string>();
  for (const [nodeId, decision] of Object.entries(event.knockout?.decisions ?? {})) {
    if (decision.method !== 'forfeit' && decision.method !== 'withdrawal') continue;
    const prefix = `ko-${nodeId}-r`;
    for (const a of event.assignments)
      if (a.matchId.startsWith(prefix) && /^\d+$/.test(a.matchId.slice(prefix.length)))
        ids.add(a.id);
  }
  return ids;
}
