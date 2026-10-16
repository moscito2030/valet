'use client';
import type { Audit, Board, Kind, PublicEvent, Result, ResultInput, Seat } from '@/lib/model';
export type EventSummary = {
  id: string;
  name: string;
  prefix?: string;
  updatedAt?: string;
  kind: Kind;
  pairMethod?: 'mp' | 'crossimp' | 'butler';
  date: string;
  venue: string;
  status: string;
  demo: boolean;
  participants: number;
  rounds: number;
  boards: number;
  received: number;
  expected: number;
};
export type Tab = 'standings' | 'rounds' | 'boards' | 'players' | 'admin';
export type AdminEvent = PublicEvent & { audit?: Audit[]; canDirect?: boolean; club?: import("@/lib/model").BridgeEvent["club"] };
export const methodNames = { mp: 'MP', crossimp: 'CrossIMP', butler: 'ButlerIMP' };
export function pairValue(value: number | null | undefined, top: number, method = 'mp') {
  return value == null
    ? '—'
    : method === 'mp'
      ? `${number(top ? (value / top) * 100 : null)}%`
      : `${value >= 0 ? '+' : ''}${number(value, method === 'butler' ? 0 : 2)}`;
}
export const suitSymbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', NT: 'NT' };
export function pairTone(value: number | null | undefined, top: number, method: string) {
  if (value == null || (method === 'mp' && top <= 0)) return 'score-neutral';
  const score = method === 'mp' ? (value / top) * 100 : value;
  return score < (method === 'mp' ? 40 : -2)
    ? 'score-low'
    : score > (method === 'mp' ? 60 : 2)
      ? 'score-high'
      : 'score-neutral';
}
export const seatNames: Record<Seat, string> = { N: '北', E: '東', S: '南', W: '西' };
export const vulNames: Record<string, string> = {
  None: '雙方無身價',
  NS: '南北有身價',
  EW: '東西有身價',
  All: '雙方有身價',
};
export function hasDeal(b: PublicEvent['boards'][number]): b is Board {
  return 'deal' in b;
}
export function number(n: number | null, places = 2) {
  return n === null ? '—' : n.toFixed(places);
}
export function signed(n: number) {
  return n > 0 ? `+${n}` : String(n);
}
export function displayContract(r: ResultInput) {
  if (r.miniBridge) return `${suitSymbols[r.strain]} ${r.level === 1 ? '一線' : '成局'}`;
  return r.level === 0
    ? 'PASS'
    : `${r.level}${suitSymbols[r.strain]}${r.doubled === 2 ? 'x' : r.doubled === 4 ? 'xx' : ''}`;
}
export function resultText(r: ResultInput) {
  const delta = r.tricks - r.level - 6;
  return r.level === 0 ? '—' : delta === 0 ? '=' : signed(delta);
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? '連線失敗');
  return json;
}
export function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Contract({ result }: { result?: Result }) {
  if (result?.status === 'average') return <span className="cancelled-contract">取消</span>;
  if (result?.status === 'cancelled') return <span className="cancelled-contract">取消</span>;
  return result ? (
    <span className={`contract ${result.strain === 'H' || result.strain === 'D' ? 'red' : ''}`}>
      {displayContract(result)}{' '}
      <small>
        {result.level ? seatNames[result.declarer] : ''} {resultText(result)}
        {result.split && ' · 判'}
      </small>
    </span>
  ) : (
    <span className="muted">待收分</span>
  );
}
