export function participantResultsLink(event: string, person: string, round: number) {
  const params = new URLSearchParams({ event, view: 'players', person });
  if (Number.isSafeInteger(round) && round > 0) params.set('round', String(round));
  return `/?${params}`;
}

export function resultsSelection(params: URLSearchParams, event: {
  id: string; rounds: number; participants: readonly { id: string }[];
}) {
  if (params.get('event') !== event.id || params.get('view') !== 'players') return null;
  const person = params.get('person') ?? '';
  const round = Number(params.get('round'));
  return {
    person: event.participants.some(p => p.id === person) ? person : '',
    round: Number.isSafeInteger(round) && round > 0 && round <= event.rounds ? round : 1,
  };
}
