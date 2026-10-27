import type { BridgeEvent, Projection } from './model';
import { knockoutLegs, knockoutMatchId, knockoutScore } from './knockout';
import { csvCell } from './csv-cell';
import type { KnockoutSource } from './knockout-schema';

type ReportEvent = Pick<
  BridgeEvent,
  'name' | 'stageName' | 'participants' | 'knockout' | 'teamMethod' | 'assignments'
> & { projection: Projection };
export const knockoutDecisionLabel = (method?: string) =>
  ({
    score: '累積成績',
    director: '裁判決勝',
    forfeit: '本場棄權',
    withdrawal: '退賽',
    bye: '輪空',
  })[method ?? ''] ?? '裁判確認';

export function knockoutReportRows(event: ReportEvent) {
  const header = [
    '賽段',
    '對局ID',
    '對局',
    'A來源',
    'B來源',
    '桌號',
    '紀錄',
    '圈次',
    '牌號',
    'A隊',
    'B隊',
    '單位',
    '已比對',
    '原訂牌數',
    '本節A',
    '本節B',
    '累積A',
    '累積B',
    '調整A',
    '調整B',
    '勝隊',
    '敗隊',
    '決勝方式',
    '決勝理由',
    '勝方名次',
    '敗方名次',
    '調整理由',
  ];
  const rows: unknown[][] = [header];
  const ko = event.knockout;
  if (!ko) return rows;
  const name = (id?: string | null) =>
    id ? (event.participants.find((p) => p.id === id)?.name ?? id) : '';
  for (const node of ko.nodes) {
    const p = ko.published[node.id],
      d = ko.decisions[node.id],
      adjustment = ko.adjustments?.[node.id];
    const unit = event.teamMethod === 'bam' ? 'BAM' : 'IMP';
    const source = (s: KnockoutSource) => (s.kind === 'bye' ? 'bye' : `${s.kind}:${s.id}`);
    const base = [
      event.stageName ?? event.name,
      node.id,
      node.name,
      source(node.a),
      source(node.b),
      node.table,
    ];
    let a = 0,
      b = 0;
    for (const leg of knockoutLegs(event, node)) {
      const m = event.projection.matches.find((m) => m.id === knockoutMatchId(node.id, leg.round));
      const assignment = event.assignments.find((x) => x.matchId === m?.id);
      const x = event.teamMethod === 'bam' ? (m?.bamA ?? 0) : (m?.marginA ?? 0);
      const y = event.teamMethod === 'bam' ? (m?.bamB ?? 0) : (m?.marginB ?? 0);
      a += x;
      b += y;
      rows.push([
        ...base,
        leg.extra ? '加賽節' : '正規節',
        leg.round,
        assignment?.boards.join(';') ?? '',
        name(p?.a),
        name(p?.b),
        unit,
        m?.completed ?? 0,
        m?.total ??
          (leg.extra
            ? (ko.extraLegs?.[node.id]?.find((l) => l.round === leg.round)?.boards.length ?? 0)
            : node.boardsPerRound),
        m ? x : '',
        m ? y : '',
        a,
        b,
        '',
        '',
        '',
        '',
        d ? knockoutDecisionLabel(d.method) : p ? '待確認' : '待公布',
        d?.reason ?? '',
        '',
        '',
        '',
      ]);
    }
    const total = knockoutScore(event, node, event.projection);
    rows.push([
      ...base,
      '對局合計',
      '',
      '',
      name(p?.a),
      name(p?.b),
      unit,
      '',
      '',
      total.rawA,
      total.rawB,
      total.a,
      total.b,
      adjustment?.a ?? 0,
      adjustment?.b ?? 0,
      name(d?.winner),
      name(d?.loser),
      d ? knockoutDecisionLabel(d.method) : total.complete ? '待確認' : '未完成',
      d?.reason ?? '',
      d?.winner ? (node.winnerPlace ?? '') : '',
      d?.loser ? (node.loserPlace ?? '') : '',
      adjustment?.reason ?? '',
    ]);
  }
  return rows;
}

export function exportKnockoutCsv(event: ReportEvent) {
  return (
    '\uFEFF' +
    knockoutReportRows(event)
      .map((r) => r.map(csvCell).join(','))
      .join('\n')
  );
}

export function knockoutPrintHtml(event: ReportEvent) {
  const escape = (value: unknown) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!,
    );
  const [header, ...rows] = knockoutReportRows(event);
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>${escape(event.stageName ?? event.name)} 淘汰賽成績</title><style>@page{size:A3 landscape;margin:10mm}body{font:12px system-ui}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:5px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}</style><h1>${escape(event.stageName ?? event.name)} 淘汰賽成績</h1><p>未打牌局不補造結果；未確認名次保留空白。</p><table><thead><tr>${header.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`;
}
