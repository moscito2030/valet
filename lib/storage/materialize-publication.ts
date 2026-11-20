import { materializeBoardPublication, effectiveBoardPublished } from '../board-publication';
import type { Board, BridgeEvent, StoredEvent } from '../model';
import { captureSql, commitSql } from './batch';
import type { Sql } from './neon';
import { storageGate } from './switch';

type StageSettings = BridgeEvent & { publishBoards?: boolean };

export type PublicationReport = {
  mode: 'dry-run' | 'write';
  switch: 'legacy' | 'normalized';
  stages: number;
  boards: number;
  legacy: string;
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
  const gate = await storageGate(sql);
  if (gate.mode === 'missing') throw new Error('storage switch is missing');
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
  let legacyCount = 0;
  let legacyLabel = gate.mode === 'normalized' ? 'untouched' : 'updated 0';
  const legacyUpdates: { id: string; document: string }[] = [];
  if (gate.mode === 'legacy') {
    const documents =
      await sql`SELECT id, document FROM bridge_events WHERE document ? 'event' ORDER BY id`;
    for (const row of documents) {
      const stored = row.document as StoredEvent;
      const event = stored.event as BridgeEvent & { publishBoards?: boolean };
      if (!Object.prototype.hasOwnProperty.call(event, 'publishBoards')) continue;
      const beforeDeals = event.boards.map(dealText);
      const beforeCards = event.boards.map(cards);
      const beforeFlags = event.boards.map((board) => effectiveBoardPublished(event, board));
      const materialized = materializeBoardPublication(event);
      materialized.boards.forEach((board, index) => {
        if (dealText(board) !== beforeDeals[index] || cards(board) !== beforeCards[index])
          throw new Error(`deals changed ${event.id}`);
        if (board.published !== beforeFlags[index]) throw new Error(`publication changed ${event.id}`);
      });
      legacyUpdates.push({
        id: String(row.id),
        document: JSON.stringify({ ...stored, event: materialized }),
      });
    }
    legacyCount = legacyUpdates.length;
    legacyLabel = `updated ${legacyCount}`;
  }
  if (!options.dryRun && (stageUpdates.length || boardUpdates.length || legacyUpdates.length)) {
    const cap = captureSql();
    for (const update of stageUpdates)
      cap.sql`UPDATE bridge_stages SET settings = ${update.settings}::jsonb WHERE id = ${update.id}`;
    for (const update of boardUpdates)
      cap.sql`UPDATE bridge_boards SET document_json = ${update.documentJson}
        WHERE event_id = ${update.eventId} AND board_number = ${update.boardNumber}`;
    for (const update of legacyUpdates)
      cap.sql`UPDATE bridge_events SET document = ${update.document}::jsonb, updated_at = now() WHERE id = ${update.id}`;
    await commitSql(sql, cap.batches);
  }
  return {
    mode: options.dryRun ? 'dry-run' : 'write',
    switch: gate.mode,
    stages: stageUpdates.length,
    boards: boardUpdates.length,
    legacy: options.dryRun && gate.mode === 'legacy' ? `would update ${legacyCount}` : legacyLabel,
  };
}

export function formatPublicationReport(report: PublicationReport) {
  return [
    `mode: ${report.mode}`,
    `switch: ${report.switch}`,
    `stages: ${report.stages}`,
    `boards: ${report.boards}`,
    `legacy: ${report.legacy}`,
    'deals: unchanged',
  ].join('\n');
}
