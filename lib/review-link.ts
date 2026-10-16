import type { Board } from './model';

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
export async function reviewUrl(board: Board, destination: URL): Promise<string> {
  const id = `board:${board.number}`;
  const data = {
    version: 1,
    title: `第 ${board.number} 副檢討`,
    boards: [{ id, number: board.number, dealer: board.dealer,
      vulnerability: board.vulnerability, deal: board.deal }],
    results: [], selectedBoardId: id,
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
