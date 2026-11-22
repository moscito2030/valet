import { posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';

type Cell = string | number | boolean;
export type Sheet = Map<number, Map<string, Cell>>;

function zipMembers(zip: Buffer) {
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557)) {
    if (
      zip.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + zip.readUInt16LE(end + 20) === zip.length
    )
      break;
    end--;
  }
  if (end < Math.max(0, zip.length - 65557)) throw new Error('無效的 ZIP 結尾');
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  if (
    zip.readUInt32LE(end + 4) ||
    count === 65535 ||
    zip.readUInt16LE(end + 8) !== count ||
    cursor + zip.readUInt32LE(end + 12) !== end
  )
    throw new Error('不支援的 ZIP 目錄');

  const members = new Map<string, () => string>();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || zip.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error('無效的 ZIP 目錄項目');
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const size = zip.readUInt32LE(cursor + 20);
    const length = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const offset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
    if (cursor > end || members.has(name)) throw new Error('無效的 ZIP 項目名稱');
    members.set(name, () => {
      if (
        flags & 1 ||
        length > 64 * 1024 * 1024 ||
        offset + 30 > end ||
        zip.readUInt32LE(offset) !== 0x04034b50
      )
        throw new Error('不支援的 ZIP 項目');
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      if (start + size > end || (method !== 0 && method !== 8))
        throw new Error('無效的 ZIP 項目內容');
      const input = zip.subarray(start, start + size);
      const data =
        method === 0 ? input : inflateRawSync(input, { maxOutputLength: Math.max(1, length) });
      if (data.length !== length) throw new Error('ZIP 項目長度不符');
      return data.toString('utf8');
    });
  }
  return members;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key: string) =>
    key[0] === '#'
      ? String.fromCodePoint(key[1] === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1)))
      : entities[key],
  );
}

function attributes(text: string) {
  return Object.fromEntries(
    Array.from(
      text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g),
      ([, name, double, single]) => [name, unescapeXml(double ?? single)],
    ),
  );
}

function richText(xml: string) {
  return Array.from(
    xml.replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?=[\s>])[^>]*>([\s\S]*?)<\/t>/g),
    ([, value]) => unescapeXml(value),
  ).join('');
}

function readSheet(xml: string, strings: string[]): Sheet {
  const sheet: Sheet = new Map();
  for (const [, attrs, body] of xml.matchAll(/<c(?=[\s/>])([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    if (body === undefined) continue;
    const { r, t } = attributes(attrs);
    const coordinate = /^([A-Z]+)([1-9]\d*)$/.exec(r);
    if (!coordinate) throw new Error('無效的儲存格位置');
    const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
    let value: Cell;
    if (t === 'inlineStr') value = richText(body);
    else if (raw === undefined) continue;
    else if (t === 's') {
      value = strings[Number(raw)];
      if (!/^\d+$/.test(raw) || value === undefined) throw new Error('無效的共用字串索引');
    } else if (t === 'str' || t === 'e' || t === 'd') value = unescapeXml(raw);
    else if (t === 'b') value = raw === '1';
    else if (raw.trim() && Number.isFinite(Number(raw))) value = Number(raw);
    else continue;
    const [, column, rowText] = coordinate;
    const row = Number(rowText);
    if (!sheet.has(row)) sheet.set(row, new Map());
    sheet.get(row)!.set(column, value);
  }
  return sheet;
}

export function readWorkbook(zip: Buffer) {
  const members = zipMembers(zip);
  function read(path: string) {
    const member = members.get(path);
    if (!member) throw new Error('缺少必要的 XLSX XML 檔案');
    return member();
  }
  const relationships = new Map<string, string>();
  for (const [, attrs] of read('xl/_rels/workbook.xml.rels').matchAll(
    /<Relationship\s+([^>]+)>/g,
  )) {
    const { Id, Target, TargetMode } = attributes(attrs);
    if (Target && TargetMode !== 'External') {
      relationships.set(
        Id,
        Target.startsWith('/') ? posix.normalize(Target.slice(1)) : posix.join('xl', Target),
      );
    }
  }
  const paths = new Map<string, string>();
  for (const [, attrs] of read('xl/workbook.xml').matchAll(/<sheet\s+([^>]+)>/g)) {
    const entry = attributes(attrs);
    const path = relationships.get(entry['r:id']);
    if (path) paths.set(entry.name, path);
  }
  const strings = Array.from(
    (members.get('xl/sharedStrings.xml')?.() ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
    ([, value]) => richText(value),
  );
  return {
    names: [...paths.keys()],
    sheet(name: string) {
      const path = paths.get(name);
      if (!path) throw new Error('缺少必要的工作表');
      return readSheet(read(path), strings);
    },
  };
}
