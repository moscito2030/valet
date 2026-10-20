import type { Mutation } from './model';
import type { SessionRole } from './session-token';
// Every mutation must declare its role requirement; new actions fail type checking until classified.
const access: Record<Mutation['action'], 'staff' | 'director' | 'club'> = {
  'knockout-config': 'director',
  'knockout-publish': 'director',
  'knockout-decide': 'director',
  'knockout-reopen': 'director',
  'stage-archive': 'director',
  'pair-name': 'director',
  'participants-setup': 'director',
  'rosters-import': 'director',
  'lineups-import': 'director',
  'clear-results': 'director',
  'results-import': 'director',
  'round-times-import': 'director',
  'movement-plan': 'director',
  'swiss-config': 'director',
  'swiss-publish': 'director',
  'team-roster': 'director',
  'table-lineup': 'staff',
  'competition-settings': 'director',
  'club-config': 'club',
  'club-play': 'club',
  'club-finalize': 'club',
  'club-complete-table': 'club',
  'round-control': 'director',
  'round-timing': 'director',
  'board-publication': 'director',
  'split-contract': 'director',
  'clear-result': 'staff',
  ruling: 'staff',
  penalty: 'staff',
  results: 'staff',
  settings: 'staff',
  pbn: 'director',
  movement: 'director',
};
export function canMutate(role: SessionRole | null, command: Mutation) {
  if (!role || access[command.action] === 'club') return false;
  if (access[command.action] === 'director') return role === 'director';
  if (
    command.action === 'settings' &&
    (command.status === 'finished' ||
      command.teamMethod !== undefined ||
      command.bam !== undefined ||
      command.name !== undefined ||
      command.prefix !== undefined ||
      command.maxBoardNumber !== undefined ||
      command.audienceRefreshSeconds !== undefined ||
      command.danmakuDefaultEnabled !== undefined ||
      command.showScoreCandles !== undefined ||
      command.stageName !== undefined ||
      command.date !== undefined ||
      command.endDate !== undefined ||
      command.venueOverride !== undefined)
  )
    return role === 'director';
  return true;
}
