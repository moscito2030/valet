import { applyKnockoutCommand } from './knockout';
import type { Mutation } from '../model';
import { applyRosterMutation, isRosterMutation } from '../roster-mutations';
import { applyCollectionCommand } from './collection';
import type { MutationContext } from './context';
import { applyDealsCommand } from './deals';
import { applyScheduleCommand } from './schedule';
import { applyScoresCommand } from './scores';
import { applySettingsCommand } from './settings';

export function dispatchMutation(context: MutationContext, command: Mutation) {
  if (isRosterMutation(command)) {
    context.detail = applyRosterMutation(context.event, command);
    return;
  }
  switch (command.action) {
    case 'knockout-adjust':
    case 'knockout-overtime':
    case 'knockout-forfeit':
    case 'knockout-config':
    case 'knockout-publish':
    case 'knockout-decide':
    case 'knockout-reopen':
      return applyKnockoutCommand(context, command);
    case 'clear-results':
    case 'results':
    case 'results-import':
    case 'penalty':
    case 'split-contract':
    case 'clear-result':
    case 'ruling':
      return applyScoresCommand(context, command);
    case 'club-config':
    case 'club-play':
    case 'club-complete-table':
    case 'club-finalize':
      return applyCollectionCommand(context, command);
    case 'round-control':
    case 'round-times-import':
    case 'round-timing':
    case 'swiss-config':
    case 'swiss-publish':
    case 'movement-plan':
    case 'movement':
      return applyScheduleCommand(context, command);
    case 'stage-archive':
    case 'competition-settings':
    case 'settings':
      return applySettingsCommand(context, command);
    case 'board-publication':
    case 'pbn':
      return applyDealsCommand(context, command);
    default: {
      const unhandled: never = command;
      throw new Error('Unhandled mutation: ' + String(unhandled));
    }
  }
}
