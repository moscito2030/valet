import type { ResultInput, Seat } from '@/lib/model';
import { hcpDeclarer, recordedHcpSchema } from '@/lib/recorded-hcp';
const labels = { N: '北', S: '南', E: '東', W: '西' };
export function HcpFields({ value, onChange, dealer }: { value: ResultInput; onChange: (v: ResultInput) => void; dealer: Seat }) {
  const hcp = value.hcp ?? {};
  const valid = recordedHcpSchema.safeParse(hcp);
  const declarer = valid.success ? hcpDeclarer(hcp, dealer) : undefined;
  return <fieldset className="hcp-fields"><legend>四家大牌點（選填）</legend>
    <div className="hcp-cross">{(['N','W','E','S'] as const).map(seat => <label className={`field hcp-${seat}`} key={seat}>{labels[seat]}
      <input ref={node => { node?.setCustomValidity(valid.success ? '' : valid.error.issues[0].message); }} aria-label={`${labels[seat]}家大牌點`} type="number" inputMode="numeric" min={0} max={37} step={1} value={hcp[seat] ?? ''}
        onChange={e => { const next = { ...hcp }; if (e.target.value === '') delete next[seat]; else next[seat] = Number(e.target.value); onChange({ ...value, hcp: Object.keys(next).length ? next : undefined }); }} />
    </label>)}</div>
    <p className="footnote">已填合計 {Object.values(hcp).reduce((a,b) => a + (b ?? 0),0)}／40</p>
    {!valid.success && <p role="alert">{valid.error.issues[0].message}</p>}
    {declarer === null ? <p role="status">兩方各 20 點，依迷你橋牌規則應重新發牌。</p> : declarer && <p role="status">點力判定莊家：{labels[declarer]}{declarer !== value.declarer ? '；與目前登錄不同，請核對或交由裁判處理。' : ''}</p>}
  </fieldset>;
}
export function HcpSummary({ hcp }: { hcp?: ResultInput['hcp'] }) {
  return hcp && Object.keys(hcp).length ? <small>大牌點：{(['N','E','S','W'] as const).map(s => `${labels[s]} ${hcp[s] ?? '—'}`).join(' · ')}</small> : null;
}
