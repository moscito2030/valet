import type { BridgeEvent, Result } from '../model';

// Handlers only edit the detached working copy. The coordinator commits it once.
export type MutationContext = {
  event: BridgeEvent;
  at: string;
  changes: { key: string; before: Result | null; after: Result | null }[];
  detail?: string;
};
