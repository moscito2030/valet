import { resultKey, type Board, type BridgeEvent } from './model';
import { tableNames } from './table-names';

export type ReviewContext = Pick<BridgeEvent, 'id' | 'assignments' | 'results' | 'kind' | 'participants' | 'gameMode'>;

export function reviewDestination(configured: string | undefined, current: string): URL {
  const origin = new URL(current);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (!configured?.trim() && !local) throw new Error('尚未設定 Valet Review 網址');
  const url = new URL(configured?.trim() || `${origin.protocol}//${origin.hostname}:3001/`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Valet Review 網址必須是 HTTP 或 HTTPS');
  url.hash = '';
  return url;
}

// Valet Review's version 1 share format: gzip JSON in a base64url fragment.
export async function reviewUrl(board: Board, destination: URL, event?: ReviewContext, selectedAssignmentId?: string): Promise<string> {
  const id = `board:${board.number}`;
  const results = event ? event.assignments.filter(a => a.boards.includes(board.number)).flatMap(a => {
    const r = event.results[resultKey(a.id, board.number)];
    if (!r) return [];
    return [{
      id: resultKey(a.id, board.number), boardId: id, assignmentId: a.id, board: board.number,
      table: `第 ${a.round} 圈 · 第 ${a.table} 桌${a.room === 'pairs' ? '' : a.room === 'open' ? ' · 開室' : ' · 閉室'}`,
      level: r.level, strain: r.strain, doubled: r.doubled, declarer: r.declarer, tricks: r.tricks,
      lead: /^[SHDC][AKQJT98765432]$/.test(r.lead) ? r.lead : '',
      status: r.status === 'cancelled' || r.status === 'average' ? 'cancelled' : 'played',
      nsScore: r.nsScore, split: r.split, playerNames: tableNames(event.kind, event.participants, a),
      updatedAt: r.updatedAt, miniBridge: r.miniBridge ?? event.gameMode === 'minibridge',
    }];
  }) : [];
  const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
  // Event IDs identify stages globally; board.number is the internal, unwrapped board key.
  const originKey = event ? await digest(JSON.stringify(['valet', event.id, board.number])) : crypto.randomUUID();
  const identifiedResults = await Promise.all(results.map(async r => ({ ...r,
    originKey: await digest(JSON.stringify([originKey, r.assignmentId])),
  })));
  const data = {
    version: 1,
    title: `第 ${board.number} 副檢討`,
    boards: [{ id, originKey, number: board.number, dealer: board.dealer,
      vulnerability: board.vulnerability, deal: board.deal }],
    results: identifiedResults, selectedBoardId: id,
    selectedResultId: results.find(r => r.assignmentId === selectedAssignmentId)?.id,
  };
  const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  if (encoded.length > 12000) throw new Error('牌局資料超過分享連結長度限制');
  const url = new URL(destination);
  url.hash = `review=1.${encoded}`;
  return url.href;
}
