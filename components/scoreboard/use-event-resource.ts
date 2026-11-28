import { mergeEventProgress, type eventProgress } from '@/lib/round-progress';
import type { PublicEvent } from '@/lib/model';
import { createFinishedEventCache } from '@/lib/finished-event-cache';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Tab, type EventSummary } from '../scoreboard-shared';

const finishedCache = createFinishedEventCache(() => localStorage);

// A single public resource owns refresh ordering and the audience polling policy.
export function useEventResource(id: string, tab: Tab, setError: (message: string) => void, summary?: EventSummary) {
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoRefreshDisabled, setAutoRefreshDisabled] = useState(false);
  const held = useRef<{ tag: string; event: PublicEvent } | null>(null);
  const requestGeneration = useRef(0);
  const catalog = useRef(summary);
  catalog.current = summary;
  const refreshEvent = useCallback(
    async (signal?: AbortSignal, force = false) => {
      if (!id) return;
      const generation = ++requestGeneration.current;
      const entry = catalog.current;
      const version = entry?.id === id && entry.status === 'finished' && entry.updatedAt
        ? JSON.stringify(entry) : undefined;
      let data: PublicEvent;
      try {
        const cached = !force && finishedCache.read(id, version);
        if (cached) data = cached;
        else {
          const url = `/api/events/${encodeURIComponent(id)}`;
          const options = { signal, cache: 'no-cache' as const };
          const progress = await api<ReturnType<typeof eventProgress> & { snapshotTag: string; autoRefreshDisabled: boolean }>(`${url}/progress`, options);
          if (generation === requestGeneration.current) {
            setAutoRefreshDisabled(progress.autoRefreshDisabled);
            if (progress.autoRefreshDisabled) setAutoRefresh(false);
          }
          const tag = progress.snapshotTag;
          let snapshot = held.current?.tag === tag && held.current.event.id === id ? held.current.event : null;
          if (!snapshot) {
            const response = await fetch(`${url}/standings/${tag.slice(1, -1)}`, { signal });
            if (!response.ok) throw Object.assign(new Error((await response.json()).error), { status: response.status });
            snapshot = await response.json() as PublicEvent;
          }
          data = mergeEventProgress(snapshot, progress);
          if (generation === requestGeneration.current) held.current = { tag, event: data };
        }
      }
      catch (error) {
        if ([401, 403, 404].includes((error as { status?: number }).status ?? 0) && generation === requestGeneration.current) { held.current = null; setEvent(null); }
        throw error;
      }
      if (generation === requestGeneration.current) {
        // A newer response cannot be stored against an older catalog revision.
        finishedCache.write(data, data.updatedAt === entry?.updatedAt ? version : undefined);
        setEvent(data);
        setError('');
      }
    },
    [id],
  );
  useEffect(() => {
    if (!autoRefresh || autoRefreshDisabled || !event || event.status === 'finished' || tab === 'admin') return;
    const interval = (event.audienceRefreshSeconds ?? 30) * 1000;
    const isActive = () => document.visibilityState === 'visible' && document.hasFocus();
    let active = isActive();
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    let failures = 0;
    const tick = async () => {
      if (!isActive()) return;
      controller = new AbortController();
      const { signal } = controller;
      try {
        await refreshEvent(signal);
        failures = 0;
      } catch (error) {
        if (!alive || signal.aborted) return;
        if ([401, 403, 404].includes((error as { status?: number }).status ?? 0)) { setError('此賽事目前無法存取。'); return; }
        failures++;
        setError('更新失敗，保留上次成績。連線恢復後會重試。');
      }
      if (alive && !signal.aborted) timer = setTimeout(tick, Math.min(120000, interval * 2 ** failures));
    };
    const onActivityChange = () => {
      const next = isActive();
      if (next === active) return;
      active = next;
      if (active) void tick();
      else {
        clearTimeout(timer);
        controller?.abort();
      }
    };
    if (active) timer = setTimeout(tick, interval);
    document.addEventListener('visibilitychange', onActivityChange);
    window.addEventListener('focus', onActivityChange);
    window.addEventListener('blur', onActivityChange);
    return () => {
      clearTimeout(timer);
      alive = false;
      document.removeEventListener('visibilitychange', onActivityChange);
      window.removeEventListener('focus', onActivityChange);
      window.removeEventListener('blur', onActivityChange);
    };
  }, [autoRefresh, autoRefreshDisabled, event?.id, event?.status, event?.audienceRefreshSeconds, tab, refreshEvent, setError]);

  return { event, setEvent, requestGeneration, refreshEvent, autoRefresh, setAutoRefresh, autoRefreshDisabled };
}
