import type { BridgeEvent } from './model';
type AwardEvent = Pick<BridgeEvent, 'kind' | 'participants' | 'awardPlaces' | 'awardPlacesNS' | 'awardPlacesEW'>;
export function hasDirectionalAwards(event: Pick<BridgeEvent, 'kind' | 'participants'>) {
  return event.kind === 'pairs' && event.participants.length > 0 && event.participants.every(p => p.group === 'NS' || p.group === 'EW');
}
export function awardPlacesFor(event: AwardEvent, side?: string) {
  if (hasDirectionalAwards(event)) {
    if (side === 'NS') return event.awardPlacesNS ?? event.awardPlaces ?? 3;
    if (side === 'EW') return event.awardPlacesEW ?? event.awardPlaces ?? 3;
  }
  return event.awardPlaces ?? 3;
}
export function awardRangeDescription(event: AwardEvent) {
  const label = (n: number) => n === 0 ? '不給獎' : `前 ${n} 名（同分並列）`;
  return hasDirectionalAwards(event)
    ? `NS：${label(awardPlacesFor(event, 'NS'))}；EW：${label(awardPlacesFor(event, 'EW'))}`
    : `給獎範圍：${label(awardPlacesFor(event))}`;
}
