import { materializeBoardPublication } from '../board-publication';
import type { Board, BridgeEvent } from '../model';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { requireNormalizedStorage } from './switch';

type StageSettings = BridgeEvent & { publishBoards?: boolean };

export type PublicationReport = {
  mode: 'dry-run' | 'write';
  stages: number;
  boards: number;
};

function dealText(board: Board) {
  return JSON.stringify(board.deal);
}

function cards(board: Board) {
  return Object.values(board.deal).flat().join(',');
}

export async function materializePublication(
  sql: Sql,
  options: { dryRun: boolean },
): Promise<PublicationReport> {
  if (!sql.transaction) throw new Error('需要 neon() 的 sql.transaction。請用 HTTPS 連線，不要用 Postgres 連線埠。');
  await requireNormalizedStorage(sql);
  const stages = await sql`SELECT id, settings FROM bridge_stages ORDER BY id`;
  const boardRows =
    await sql`SELECT event_id, board_number, document_json FROM bridge_boards ORDER BY event_id, ordinal`;
  const boardsByEvent = new Map<string, { board_number: number; document_json: string }[]>();
  for (const row of boardRows) {
    const id = String(row.event_id);
    const list = boardsByEvent.get(id) ?? [];
    list.push({ board_number: Number(row.board_number), document_json: String(row.document_json) });
    boardsByEvent.set(id, list);
  }
  const stageUpdates: { id: string; settings: string }[] = [];
  const boardUpdates: { eventId: string; boardNumber: number; documentJson: string }[] = [];
  for (const stage of stages) {
    const id = String(stage.id);
    const settings = stage.settings as StageSettings;
    const boards = (boardsByEvent.get(id) ?? []).map((row) => JSON.parse(row.document_json) as Board);
    const beforeDeals = boards.map(dealText);
    const beforeCards = boards.map(cards);
    const event = { ...settings, boards };
    const materialized = materializeBoardPublication(event);
    materialized.boards.forEach((board, index) => {
      if (dealText(board) !== beforeDeals[index] || cards(board) !== beforeCards[index])
        throw new Error(`deals changed ${id}`);
      const previous = boards[index];
      if (previous.published === board.published && typeof previous.published === 'boolean') return;
      boardUpdates.push({
        eventId: id,
        boardNumber: board.number,
        documentJson: JSON.stringify(board),
      });
    });
    if (Object.prototype.hasOwnProperty.call(settings, 'publishBoards')) {
      const nextSettings = { ...settings };
      delete nextSettings.publishBoards;
      stageUpdates.push({ id, settings: JSON.stringify(nextSettings) });
    }
  }
  if (!options.dryRun && (stageUpdates.length || boardUpdates.length)) {
    const cap = captureSql();
    for (const update of stageUpdates)
      cap.sql`UPDATE bridge_stages SET settings = ${update.settings}::jsonb WHERE id = ${update.id}`;
    for (const update of boardUpdates)
      cap.sql`UPDATE bridge_boards SET document_json = ${update.documentJson}
        WHERE event_id = ${update.eventId} AND board_number = ${update.boardNumber}`;
    await commitSql(sql, cap.batches);
  }
  return {
    mode: options.dryRun ? 'dry-run' : 'write',
    stages: stageUpdates.length,
    boards: boardUpdates.length,
  };
}

export function formatPublicationReport(report: PublicationReport) {
  return [
    `mode: ${report.mode}`,
    `stages: ${report.stages}`,
    `boards: ${report.boards}`,
    'deals: unchanged',
  ].join('\n');
}
