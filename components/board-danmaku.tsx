'use client';
import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { CommentText } from './comment-text';
import { useDiscussion } from './board-discussion-context';
import { nextBullets, type BulletComment } from '@/lib/discussion-bullets';
export function DanmakuToggle() {
  const { live, setLive } = useDiscussion();
  return (
    <button
      type="button"
      className="discussion-action danmaku-toggle"
      aria-pressed={live}
      onClick={() => setLive(!live)}
    >
      <MessageSquare size={15} aria-hidden="true" />
      {live ? '關閉彈幕' : '開啟彈幕'}
    </button>
  );
}
export function BoardDanmaku() {
  const { data, live, visible } = useDiscussion();
  const [active, setActive] = useState<(BulletComment & { lane: number; started: number })[]>([]);
  const queue = useRef<BulletComment[]>([]),
    seen = useRef(new Set<string>()),
    initial = useRef(true),
    lane = useRef(0);
  const playable = live && visible && !!data?.published;
  useEffect(() => {
    if (!playable) {
      queue.current = [];
      seen.current = new Set();
      initial.current = true;
      setActive([]);
      return;
    }
    const comments = data?.comments ?? [];
    const ids = new Set(comments.filter((c) => !c.hidden && !c.deleted).map((c) => c.id));
    const next = nextBullets(comments, seen.current, initial.current);
    seen.current = next.seen;
    initial.current = false;
    queue.current = [...queue.current.filter((c) => ids.has(c.id)), ...next.fresh].slice(-30);
    setActive((old) => old.filter((c) => ids.has(c.id)));
  }, [playable, data]);
  useEffect(() => {
    if (!playable) return;
    const launch = () => {
      const next = queue.current.shift(),
        now = Date.now();
      setActive((old) => [
        ...old.filter((c) => now - c.started < 7500),
        ...(next ? [{ ...next, lane: lane.current++ % 3, started: now }] : []),
      ]);
    };
    launch();
    const timer = setInterval(launch, 2800);
    return () => clearInterval(timer);
  }, [playable]);
  if (!playable) return null;
  return (
    <div className="board-danmaku" aria-hidden="true">
      {active.map((c) => (
        <div key={c.id} className="danmaku-message" style={{ top: `${16 + c.lane * 25}%` }}>
          <span className="danmaku-author">{c.nickname}：</span>
          <CommentText
            text={
              Array.from(c.text).slice(0, 120).join('') +
              (Array.from(c.text).length > 120 ? '…' : '')
            }
          />
        </div>
      ))}
    </div>
  );
}
