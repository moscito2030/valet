'use client';

import { useState } from 'react';
import type { AdminEvent } from '../scoreboard-shared';
import { Modal } from '../event-dialogs';
import { boardRange } from '@/lib/board-groups';
import { readyBoardGroups } from '@/lib/board-publication-ready';
import { roundLabel } from '@/lib/team-movement';

export function StartRoundButton({
  event,
  round,
  disabled,
  save,
}: {
  event: AdminEvent;
  round: number;
  disabled: boolean;
  save: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const groups = readyBoardGroups(event);
  const label = `開始第 ${roundLabel(event, round)} 圈`;
  async function start(publish: boolean) {
    const saved = await save({
      action: 'round-control',
      round,
      phase: 'playing',
      reason: label,
      ...(publish ? { publishGroups: groups.map((g) => g[0].number) } : {}),
    });
    // The parent displays API errors; close the dialog so they remain visible.
    if (saved !== undefined) setOpen(false);
  }
  return (
    <>
      <button
        type="button"
        className="button primary"
        disabled={disabled}
        onClick={() => (groups.length ? setOpen(true) : void start(false))}
      >
        {label}
      </button>
      {open && (
        <Modal title="這些牌群已完成，可以公開牌型" onClose={() => !disabled && setOpen(false)}>
          <p>以下牌群的預定對局已全部完成，是否同時公開？</p>
          <ul className="club-force-list">
            {groups.map((group) => (
              <li key={group[0].number}>牌 {boardRange(group.map((b) => b.number))}</li>
            ))}
          </ul>
          <p className="footnote">
            公開後可查看手牌、PBN 與雙夢家分析。已下載的牌型無法收回；本圈排名已隨結算更新。
          </p>
          <div className="button-row round-workflow-actions">
            <button
              type="button"
              className="button primary"
              disabled={disabled || !groups.length}
              onClick={() => void start(true)}
            >
              公開並進入下一圈
            </button>
            <button
              type="button"
              className="button subtle"
              disabled={disabled}
              onClick={() => void start(false)}
            >
              暫不公開，進入下一圈
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
