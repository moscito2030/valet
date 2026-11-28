import { adjustedLabel } from '@/lib/adjusted-score';
import { awardedResult } from '@/lib/scoring';
import { EditorPopover } from '../editor-popover';
import { useEffect, useState } from 'react';
import type { Audit } from '@/lib/model';
import { api, displayContract, resultText, signed } from '../scoreboard-shared';

export function AuditPanel({ eventId }: { eventId: string }) {
  const [audit, setAudit] = useState<Audit[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<Audit[]>(`/api/admin/events/${eventId}/audit`, { signal: controller.signal })
      .then(setAudit).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [eventId]);
  return (
    <div className="audit-list">
      {error && <p role="alert">{error}</p>}
      {audit.map((a) => (
        <div className="audit-item" key={a.revision}>
          <span className="audit-dot" />
          <div>
            <strong>
              {a.action} <small>v{a.revision}</small>
            </strong>
            <p>{a.reason}</p>
            {a.detail && <p className="mono">{a.detail}</p>}
            <small>
              {new Date(a.at).toLocaleString('zh-TW', {
                timeZone: 'Asia/Taipei',
                hour12: false,
              })}
            </small>
            {a.changes && (
              <EditorPopover title={`${a.changes.length} 筆結果變更`}>
                {a.changes.map((c) => (
                  <p className="mono" key={c.key}>
                    {c.key}：
                    {(c.before?.split || c.after?.split) && (
                      <span className="block">
                        不平衡合約：
                        {[c.before, c.after]
                          .map((r) =>
                            r?.split
                              ? (['ns', 'ew'] as const)
                                  .map((side) => {
                                    const awarded = awardedResult(r, side)!;
                                    return `${side.toUpperCase()} ${displayContract(awarded)} ${awarded.declarer} ${resultText(awarded)}（NS 座標 ${signed(awarded.nsScore)}）`;
                                  })
                                  .join('；')
                              : '無判罰',
                          )
                          .join(' → ')}
                      </span>
                    )}
                    {c.before
                      ? c.before.status === 'cancelled'
                        ? 'Cancelled'
                        : adjustedLabel(c.before) ?? `${displayContract(c.before)} ${c.before.declarer} ${resultText(c.before)} (${c.before.nsScore})`
                      : '未收分'}{' '}
                    →{' '}
                    {c.after
                      ? c.after.status === 'cancelled'
                        ? 'Cancelled'
                        : adjustedLabel(c.after) ?? `${displayContract(c.after)} ${c.after.declarer} ${resultText(c.after)} (${c.after.nsScore})`
                      : '刪除'}
                  </p>
                ))}
              </EditorPopover>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
