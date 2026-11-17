import 'server-only';
import path from 'node:path';
import { localDiscussionStore, switchingDiscussionStore } from './storage/discussions';
import { neonHttp } from './storage/sql-client';
import { storageMode } from './store';
import { DomainError } from './domain-error';
const local = localDiscussionStore(
  path.join(process.env.VALET_LOCAL_DATA_DIR ?? path.join(process.cwd(), '.data'), 'discussions'),
);
export function discussionStore() {
  const mode = storageMode();
  if (mode === 'demo') throw new DomainError('展示模式未開放留言', 503);
  if (mode === 'local') return local;
  return switchingDiscussionStore(neonHttp(process.env.DATABASE_URL!));
}
