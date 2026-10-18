/** ACBLscore pair movement records. No installer code is loaded or executed. */
export type AcblMovement = {
  name: string;
  tables: number;
  rounds: number;
  oneWinner: boolean;
  pairCount: number;
  nsCount: number;
  groups: number;
  // Round-major, preserving physical table numbers. Null means a phantom table.
  rows: (number[] | null)[][];
};

export function parseAcblMovement(bytes: Uint8Array, name = '外部編排'): AcblMovement {
  const fail = (message: string): never => { throw new Error(`ACBLscore 編排：${message}`); };
  if (bytes.length < 707 || bytes.length > 20000) fail('檔案長度不正確');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = data.getUint16(0, true);
  if (![0x8d5d, 0xb46d].includes(signature)) fail('請選擇雙人賽 .MOV 檔');
  const tables = bytes[3], rounds = bytes[4];
  if (tables < 2 || tables > 40 || rounds < 1 || rounds > 40) fail('桌數或圈數超出支援範圍');
  // The newer format reserves 25 round cells per table, even for shorter games.
  const stride = signature === 0xb46d ? 25 : rounds;
  if (rounds > stride || bytes.length !== 707 + tables * stride * 3) fail('桌次資料不完整');
  if (![0, 1, 128, 255].includes(bytes[2])) fail('未知的排名模式');
  const oneWinner = bytes[2] !== 0;
  if (bytes[606] !== 0) fail('此檔案含重新編號設定，請先在 ACBLscore 匯出未重新編號的編排');
  if (bytes.slice(607, 668).some(value => value !== 0) || bytes[669] !== 0)
    fail('含尚未支援的搭檔對照設定');
  const phantom = data.getInt8(668), rover = data.getInt8(670);
  if (![-1, 0, 1].includes(rover)) fail('未知的 Rover 設定');
  for (let i = 0; i < 36; i++) {
    if (bytes[671 + i] !== 0 && bytes[671 + i] !== i + 1)
      fail('此檔案含自訂牌組對照，請先匯出標準牌組編號');
  }
  const rawRows: { ns: string; ew: string; group: number }[][] = [];
  const keys = new Set<string>();
  const rows: (number[] | null)[][] = [];
  for (let r = 0; r < rounds; r++) {
    rawRows[r] = [];
    rows[r] = [];
    for (let t = 0; t < tables; t++) {
      const offset = 707 + (t * stride + r) * 3;
      const ns = data.getInt8(offset), ew = data.getInt8(offset + 1), group = data.getInt8(offset + 2);
      const isPhantom = phantom !== 0 && (oneWinner
        ? ns === Math.abs(phantom) || ew === Math.abs(phantom)
        : phantom > 0 ? ns === phantom : ew === -phantom);
      if (isPhantom) { rows[r][t] = null; continue; }
      if (ns < 1 || ew < 1 || ns > 80 || ew > 80 || group < 1 || group > 80)
        fail(`第 ${r + 1} 圈第 ${t + 1} 桌資料不正確`);
      const nsKey = `${oneWinner ? '' : 'N'}${ns}`, ewKey = `${oneWinner ? '' : 'E'}${ew}`;
      if (nsKey === ewKey) fail('搭檔不能與自己對戰');
      rawRows[r][t] = { ns: nsKey, ew: ewKey, group };
      keys.add(nsKey); keys.add(ewKey);
    }
  }
  const pairKeys = [...keys].sort((a, b) => {
    const side = (x: string) => x.startsWith('E') ? 1 : 0;
    return side(a) - side(b) || Number(a.replace(/^[NE]/, '')) - Number(b.replace(/^[NE]/, ''));
  });
  if (pairKeys.length < 3 || pairKeys.length > 80) fail('搭檔數須為 3–80 對');
  const played = new Set<string>();
  for (let r = 0; r < rounds; r++) {
    const occupied = new Set<string>();
    for (let t = 0; t < tables; t++) {
      const cell = rawRows[r][t];
      if (!cell) continue;
      for (const key of [cell.ns, cell.ew]) {
        if (occupied.has(key)) fail(`第 ${r + 1} 圈搭檔重複出場`);
        occupied.add(key);
        if (played.has(`${key}:${cell.group}`)) fail('搭檔重複打同一牌組');
        played.add(`${key}:${cell.group}`);
      }
      rows[r][t] = [pairKeys.indexOf(cell.ns) + 1, pairKeys.indexOf(cell.ew) + 1, cell.group];
    }
    if (occupied.size !== Math.floor(pairKeys.length / 2) * 2) fail(`第 ${r + 1} 圈桌次不完整`);
  }
  return { name, tables, rounds, oneWinner, pairCount: pairKeys.length,
    nsCount: oneWinner ? 0 : pairKeys.filter(key => key.startsWith('N')).length,
    groups: Math.max(...rows.flat().flatMap(cell => cell ? [cell[2]] : [])), rows };
}
