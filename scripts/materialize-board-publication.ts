import { readFile, writeFile } from 'node:fs/promises';
import { materializeBoardPublication, effectiveBoardPublished } from '../lib/board-publication';
import type { Board, BridgeEvent, StoredEvent } from '../lib/model';

// Copy publishBoards onto each board, then remove the event-level field.
// Pass a local events.json export. This script does not open a database.
async function main() {
  const file = process.argv[2];
  if (process.env.MATERIALIZE_PUBLISH_BOARDS !== '1' || !file || file.includes('DATABASE_URL')) {
    console.error(
      'Refusing to run. Set MATERIALIZE_PUBLISH_BOARDS=1 and pass a local events.json path. Do not point this at the production database.',
    );
    process.exitCode = 1;
    return;
  }
  const documents = JSON.parse(await readFile(file, 'utf8')) as ({ event?: BridgeEvent } | StoredEvent)[];
  if (!Array.isArray(documents)) throw new Error('events.json must be an array');
  const next = documents.map((document) => {
    if (!document || !('event' in document) || !document.event) return document;
    const event = document.event as BridgeEvent & { publishBoards?: boolean };
    const before = event.boards.map((board) => ({
      number: board.number,
      published: effectiveBoardPublished(event, board),
      deal: JSON.stringify(board.deal),
    }));
    const materialized = materializeBoardPublication(event);
    const after = materialized.boards.map((board: Board) => ({
      number: board.number,
      published: board.published === true,
      deal: JSON.stringify(board.deal),
    }));
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(`公開狀態或牌型在遷移後改變：${event.id}`);
    const again = materializeBoardPublication(materialized);
    if (JSON.stringify(again) !== JSON.stringify(materialized))
      throw new Error(`遷移不是冪等的：${event.id}`);
    return { ...document, event: materialized };
  });
  await writeFile(file, JSON.stringify(next));
  console.log(`Materialized board publication for ${documents.length} documents in ${file}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
