import type { Board, PublicEvent } from '@/lib/model';
import { useEffect, useRef, useState } from 'react';
import { api, type Tab } from '../scoreboard-shared';

// Private responses belong only to the current event, board, role and tab.
export function usePrivatePreview(
  id: string,
  board: number,
  director: boolean,
  tab: Tab,
  setError: (message: string) => void,
) {
  const [privateDeal, setPrivateDeal] = useState<{
    eventId: string;
    board: Board;
    results: PublicEvent['results'];
    pairScores: PublicEvent['projection']['pairScores'];
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewGeneration = useRef(0);
  useEffect(() => {
    previewGeneration.current++;
    setPrivateDeal(null);
    setPreviewing(false);
  }, [id, board, director, tab]);
  async function previewDeal() {
    const generation = ++previewGeneration.current;
    setPreviewing(true);
    try {
      const data = await api<{
        board: Board;
        results: PublicEvent['results'];
        pairScores: PublicEvent['projection']['pairScores'];
      }>(`/api/admin/events/${id}/boards/${board}`);
      if (generation === previewGeneration.current) setPrivateDeal({ eventId: id, ...data });
    } catch (e) {
      if (generation === previewGeneration.current) setError((e as Error).message);
    } finally {
      if (generation === previewGeneration.current) setPreviewing(false);
    }
  }

  return { privateDeal, setPrivateDeal, previewing, previewDeal };
}
