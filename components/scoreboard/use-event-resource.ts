import type { PublicEvent } from '@/lib/model';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Tab } from '../scoreboard-shared';

// A single public resource owns refresh ordering and the audience polling policy.
export function useEventResource(id: string, tab: Tab, setError: (message: string) => void) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const requestGeneration = useRef(0);
  const refreshEvent = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      const generation = ++requestGeneration.current;
      let data: PublicEvent;
      try { data = await api<PublicEvent>(`/api/events/${encodeURIComponent(id)}`, { signal }); }
      catch (error) {
        if ([401, 403, 404].includes((error as { status?: number }).status ?? 0) && generation === requestGeneration.current) setEvent(null);
        throw error;
      }
      if (generation === requestGeneration.current) {
        setEvent(data);
        setError('');
      }
    },
    [id],
  );
  useEffect(() => {
    if (!event || event.status === 'finished' || tab === 'admin') return;
    let alive = true,
      timer: ReturnType<typeof setTimeout>,
      failures = 0;
    const tick = async () => {
      if (!alive) return;
      if (!document.hidden) {
        try {
          await refreshEvent();
          failures = 0;
        } catch (error) {
          if ([401, 403, 404].includes((error as { status?: number }).status ?? 0)) { setError('此賽事目前無法存取。'); return; }
          failures++;
          setError('更新失敗，保留上次成績。連線恢復後會重試。');
        }
      }
      if (alive) timer = setTimeout(tick, Math.min(120000, 30000 * 2 ** failures));
    };
    timer = setTimeout(tick, 30000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [event?.id, event?.status, tab, refreshEvent]);

  return { event, setEvent, requestGeneration, refreshEvent };
}
