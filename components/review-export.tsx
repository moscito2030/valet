'use client';
import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Board } from '@/lib/model';
import { reviewDestination, reviewUrl } from '@/lib/review-link';

export function ReviewExport({ board }: { board: Board }) {
  const [link, setLink] = useState<{ board: Board; href?: string; error?: string }>();
  useEffect(() => {
    let active = true;
    async function prepare() {
      try {
        const destination = reviewDestination(process.env.NEXT_PUBLIC_VALET_REVIEW_URL, location.href);
        const href = await reviewUrl(board, destination);
        if (active) setLink({ board, href });
      } catch (error) {
        if (active) setLink({ board, error: (error as Error).message });
      }
    }
    void prepare();
    return () => { active = false; };
  }, [board]);
  const current = link?.board === board ? link : undefined;
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
