'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Comment } from '@/lib/discussion';
export type DiscussionData = {
  published: boolean;
  director: boolean;
  globalClosed: boolean;
  closed?: boolean;
  comments: (Omit<Comment, 'author'> & { own: boolean })[];
};
type State = {
  data: DiscussionData | null;
  error: string;
  setError: (message: string) => void;
  refresh: () => Promise<void>;
  live: boolean;
  setLive: (enabled: boolean) => void;
  visible: boolean;
};
const Context = createContext<State | null>(null);
export function DiscussionProvider({
  eventId,
  board,
  children,
}: {
  eventId: string;
  board: number;
  children: ReactNode;
}) {
  const [data, setData] = useState<DiscussionData | null>(null),
    [error, setError] = useState(''),
    [live, setLive] = useState(false),
    [visible, setVisible] = useState(true);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const r = await fetch(`/api/events/${eventId}/boards/${board}/discussion`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error);
      if (!controller.signal.aborted) {
        setData(body);
        setError('');
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setData(null);
        setError((e as Error).message);
        throw e;
      }
    }
  }, [eventId, board]);
  useEffect(() => {
    refresh().catch(() => {});
    return () => request.current?.abort();
  }, [refresh]);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!live || !visible) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch {}
      if (!stopped) timer = setTimeout(poll, 10000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      request.current?.abort();
    };
  }, [live, visible, refresh]);
  return (
    <Context.Provider value={{ data, error, setError, refresh, live, setLive, visible }}>
      {children}
    </Context.Provider>
  );
}
export function useDiscussion() {
  const value = useContext(Context);
  if (!value) throw new Error('Discussion provider required');
  return value;
}
