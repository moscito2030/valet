'use client';
import { useId, useRef } from 'react';
import { ArrowDownToLine, Share2, X } from 'lucide-react';
import type { Board, PublicEvent } from '@/lib/model';
import { exportPbn } from '@/lib/imports';
import { download } from './scoreboard-shared';
import { DanmakuToggle } from './board-danmaku';
import { ReviewExport } from './review-export';

export function BoardShareActions({
  board,
  event,
  selectedAssignmentId,
}: {
  board: Board;
  event: PublicEvent;
  selectedAssignmentId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <div className="board-export-actions">
        <DanmakuToggle className="button subtle" />
        <button type="button" className="button subtle" onClick={() => dialog.current?.showModal()}>
          <Share2 size={15} />
          分享本牌
        </button>
      </div>
      <dialog ref={dialog} className="modal board-share-modal" aria-labelledby={titleId}>
        <div className="modal-heading">
          <h2 id={titleId}>分享本牌</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="關閉分享視窗"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <div className="board-share-options">
          <button
            type="button"
            className="button subtle"
            onClick={() => {
              download(`board-${board.number}.pbn`, exportPbn({ boards: [board] }));
              dialog.current?.close();
            }}
          >
            <ArrowDownToLine size={15} />
            下載此副 PBN
          </button>
          <ReviewExport board={board} event={event} selectedAssignmentId={selectedAssignmentId} />
        </div>
      </dialog>
    </>
  );
}
