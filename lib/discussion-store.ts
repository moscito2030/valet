import 'server-only';
import { neon } from '@neondatabase/serverless';
import path from 'node:path';
import { localDiscussionStore, neonDiscussionStore } from './storage/discussions';
import { storageMode } from './store';
import { DomainError } from './domain-error';
const local = localDiscussionStore(
  path.join(process.env.VALET_LOCAL_DATA_DIR ?? path.join(process.cwd(), '.data'), 'discussions'),
);
export function discussionStore() {
  const mode = storageMode();
  if (mode === 'demo') throw new DomainError('展示模式未開放留言', 503);
  return mode === 'local' ? local : neonDiscussionStore(neon(process.env.DATABASE_URL!));
}
