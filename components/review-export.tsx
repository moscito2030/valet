'use client';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Board } from '@/lib/model';
import { reviewDestination, reviewUrl, type ReviewContext } from '@/lib/review-link';

export function ReviewExport({ board, event, selectedAssignmentId }: { board: Board; event: ReviewContext; selectedAssignmentId?: string }) {
  const [link, setLink] = useState<{ board: Board; event: ReviewContext; selectedAssignmentId?: string; href?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        const destination = reviewDestination(process.env.NEXT_PUBLIC_VALET_REVIEW_URL, location.href);
        const href = await reviewUrl(board, destination, event, selectedAssignmentId);
        if (active) setLink({ board, event, selectedAssignmentId, href });
      } catch (error) {
        if (active) setLink({ board, event, selectedAssignmentId, error: (error as Error).message });
      }
    }
    void prepare();
    return () => { active = false; };
  }, [board, event, selectedAssignmentId]);
  const current = link?.board === board && link.event === event && link.selectedAssignmentId === selectedAssignmentId ? link : undefined;
  return current?.href ? (
    <a className="button subtle" href={current.href} target="_blank" rel="noopener noreferrer">
      <ArrowRight size={15} />輸出至 Valet Review
    </a>
  ) : (
    <button className="button subtle" disabled title={current?.error || '正在準備牌局連結'}>
      <ArrowRight size={15} />輸出至 Valet Review
    </button>
  );
}
