import { DomainError } from './domain-error';

export async function readJson(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 500000)
    throw new DomainError('資料超過 500 KB 上限', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('缺少請求內容');
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 500000) {
      await reader.cancel();
      throw new DomainError('資料超過 500 KB 上限', 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DomainError('JSON 格式錯誤');
  }
}
