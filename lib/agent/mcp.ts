export const valetMcpTools = [
  {
    name: 'valet_event_status',
    description: 'Read the current round, tables that have not submitted, and published board numbers.',
    method: 'GET',
    path: '/api/agent/events/{eventId}/status',
  },
  {
    name: 'valet_preview_mutation',
    description: 'Dry-run a score, publication, or settings change and return the before and after values.',
    method: 'POST',
    path: '/api/agent/events/{eventId}/preview',
  },
  {
    name: 'valet_apply_mutation',
    description: 'Apply a change once. Retries with the same Idempotency-Key return the first result.',
    method: 'POST',
    path: '/api/agent/events/{eventId}/mutations',
  },
] as const;
