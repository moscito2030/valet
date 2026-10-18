import { awardedResult } from '@/lib/scoring';
import { EditorPopover } from '../editor-popover';
import { AdminEvent, displayContract, resultText, signed } from '../scoreboard-shared';

type Props = {
  event: AdminEvent;
};
export function AuditPanel({ event }: Props) {
  return (
    <div className="audit-list">
      {[...(event.audit ?? [])].reverse().map((a) => (
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
                        : `${displayContract(c.before)} ${c.before.declarer} ${resultText(c.before)} (${c.before.nsScore})`
                      : '未收分'}{' '}
                    →{' '}
                    {c.after
                      ? c.after.status === 'cancelled'
                        ? 'Cancelled'
                        : `${displayContract(c.after)} ${c.after.declarer} ${resultText(c.after)} (${c.after.nsScore})`
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
