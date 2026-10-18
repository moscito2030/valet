'use client';
import { useState } from 'react';
import type { PublicEvent } from '@/lib/model';
import { winAwardStats } from '@/lib/win-awards';
import { roundLabel } from '@/lib/team-movement';
import { Modal } from '../event-dialogs';
export function WinAwards({
  event,
  participantIds,
}: {
  event: PublicEvent;
  participantIds: string[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!event.winAward?.enabled) return null;
  const rows = winAwardStats(event),
    selectedRow = rows.find((r) => r.id === selected);
  const labels = { win: '勝', loss: '負', draw: '和', pending: '待定', excluded: '不計' };
  const scoreLabel = event.kind === 'pairs' && (event.pairMethod ?? 'mp') === 'mp' ? '%' : ' IMP';
  return (
    <div className="win-awards">
      <h3>勝場獎統計</h3>
      <p className="footnote">
        勝／負／和：{event.winAward.win}／{event.winAward.loss}／{event.winAward.draw}{' '}
        倍。獨立於總排名，不含判罰與輪空。點按名稱查看逐圈明細。
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{event.kind === 'teams' ? '隊伍' : '搭檔'}</th>
              <th>勝</th>
              <th>負</th>
              <th>和</th>
              <th>待定</th>
              <th>不計</th>
              <th>獎勵倍數</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => participantIds.includes(r.id))
              .map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      aria-haspopup="dialog"
                      onClick={() => setSelected(r.id)}
                    >
                      {r.group && r.group + ' · '}
                      {r.name}
                    </button>
                  </td>
                  <td>{r.win}</td>
                  <td>{r.loss}</td>
                  <td>{r.draw}</td>
                  <td>{r.pending}</td>
                  <td>{r.excluded}</td>
                  <td>{Number(r.units.toFixed(6))} 倍</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <p className="footnote">
        未收齊或比較成績尚未齊全列為待定；全圈取消或無有效比較成績列為不計。交錯循環按完整對戰統計，歸於較後圈次。
      </p>
      {selectedRow && (
        <Modal title={selectedRow.name + ' · 勝場獎'} onClose={() => setSelected(null)}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>圈次</th>
                  <th>本圈成績</th>
                  <th>勝負</th>
                </tr>
              </thead>
              <tbody>
                {selectedRow.entries.map((entry) => (
                  <tr key={entry.key}>
                    <td>{roundLabel(event, entry.round)}</td>
                    <td>
                      {entry.score === null ? '—' : Number(entry.score.toFixed(4)) + scoreLabel}
                    </td>
                    <td>{labels[entry.outcome]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!selectedRow.entries.length && <p>尚無已安排的對戰。</p>}
        </Modal>
      )}
    </div>
  );
}
