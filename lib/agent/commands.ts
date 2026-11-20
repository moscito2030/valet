import { z } from 'zod';
import { mutationSchema } from '../model';

const allowedActions = new Set(['results', 'results-import', 'clear-result']);

export function isAgentAction(action: string) {
  return allowedActions.has(action);
}

const commands = z.union(mutationSchema.options.filter(
  (schema) => isAgentAction(schema.shape.action.value),
));

export const agentCommandSchema = z.object({ requestId: z.uuid(), command: commands }).strict()
  .refine(({ requestId, command }) => requestId === command.requestId, '兩個 requestId 必須相同');
