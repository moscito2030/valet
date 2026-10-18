import type { ResultInput, Seat } from '@/lib/model';
import { hcpDeclarer, hcpMismatches, recordedHcpSchema, type RecordedHcp } from '@/lib/recorded-hcp';
const labels = { N: '北', S: '南', E: '東', W: '西' };
export function HcpFields({ value, onChange, expected }: { value: ResultInput; onChange: (v: ResultInput) => void; dealer: Seat; expected?: RecordedHcp }) {
  const hcp = value.hcp ?? {};
  const valid = recordedHcpSchema.safeParse(hcp);
  const mismatches = hcpMismatches(hcp, expected);
  return <fieldset className="hcp-fields"><legend>四家大牌點（選填）</legend>
    <div className="hcp-cross">{(['N','W','E','S'] as const).map(seat => <label className={`field hcp-${seat}`} key={seat}>{labels[seat]}
      <input aria-invalid={mismatches.includes(seat) || !valid.success} ref={node => { node?.setCustomValidity(!valid.success ? valid.error.issues[0].message : mismatches.includes(seat) ? '大牌點與本副牌型不符，請核對。' : ''); }} aria-label={`${labels[seat]}家大牌點`} type="number" inputMode="numeric" min={0} max={37} step={1} value={hcp[seat] ?? ''}
        onChange={e => { const next = { ...hcp }; if (e.target.value === '') delete next[seat]; else next[seat] = Number(e.target.value); onChange({ ...value, hcp: Object.keys(next).length ? next : undefined }); }} />
    </label>)}</div>
    <p className="footnote">已填合計 {Object.values(hcp).reduce((a,b) => a + (b ?? 0),0)}／40</p>
    {mismatches.length > 0 && <p className="error-text" role="alert">{mismatches.map(s => labels[s]).join('、')}家大牌點與本副牌型不符，請核對輸入。</p>}
    {!valid.success && <p role="alert">{valid.error.issues[0].message}</p>}
  </fieldset>;
}
export function HcpSummary({ hcp }: { hcp?: ResultInput['hcp'] }) {
  return hcp && Object.keys(hcp).length ? <small>大牌點：{(['N','E','S','W'] as const).map(s => `${labels[s]} ${hcp[s] ?? '—'}`).join(' · ')}</small> : null;
}

export function DeclarerWarning({ value, dealer }: { value: ResultInput; dealer: Seat }) {
  const valid = recordedHcpSchema.safeParse(value.hcp ?? {});
  const declarer = valid.success ? hcpDeclarer(valid.data, dealer) : undefined;
  if (declarer === undefined || declarer === value.declarer) return null;
  return <p className="declarer-warning" role="alert">{declarer === null ? '兩方各 20 點，依迷你橋牌規則應重新發牌。' : `莊家方位不正確：依輸入大牌點應為${labels[declarer]}家，目前選擇${labels[value.declarer]}家。請核對或交由裁判處理。`}</p>;
}
