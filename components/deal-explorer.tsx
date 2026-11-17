'use client';

import { useEffect, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { BoardInformation, DealExplorer as ViewerDealExplorer } from '@valet/deal-viewer';
import { applyRankLineFits } from '@/lib/fit-rank-lines';

export { BoardInformation };

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function DealExplorer(props: ComponentProps<typeof ViewerDealExplorer>) {
  const root = useRef<HTMLDivElement>(null);
  useBrowserLayoutEffect(() => {
    if (root.current) applyRankLineFits(root.current);
  });
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const fit = () => applyRankLineFits(element);
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    const watch = new MutationObserver(fit);
    watch.observe(element, { childList: true, subtree: true });
    let cancelled = false;
    document.fonts?.ready
      .then(() => {
        if (!cancelled) fit();
      })
      .catch(() => {});
    document.fonts?.addEventListener('loadingdone', fit);
    window.addEventListener('beforeprint', fit);
    window.addEventListener('afterprint', fit);
    const printMedia = window.matchMedia('print');
    printMedia.addEventListener('change', fit);
    return () => {
      cancelled = true;
      observer.disconnect();
      watch.disconnect();
      window.removeEventListener('beforeprint', fit);
      window.removeEventListener('afterprint', fit);
      document.fonts?.removeEventListener('loadingdone', fit);
      printMedia.removeEventListener('change', fit);
    };
  }, []);
  return (
    <div ref={root} className="rank-line-fit">
      <ViewerDealExplorer {...props} />
    </div>
  );
}
