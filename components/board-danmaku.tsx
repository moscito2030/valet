'use client';
import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { CommentText } from './comment-text';
import { useDiscussion } from './board-discussion-context';
import { shuffledBullets, freeBulletLane, type BulletComment } from '@/lib/discussion-bullets';
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
  const [active, setActive] = useState<
    (BulletComment & { lane: number; top: number; started: number; instance: number })[]
  >([]);
  const queue = useRef<BulletComment[]>([]),
    comments = useRef<BulletComment[]>([]),
    occupied = useRef<{ lane: number; started: number }[]>([]),
    previous = useRef<string | undefined>(undefined),
    sequence = useRef(0);
  const playable = live && visible && !!data?.published;
  useEffect(() => {
    if (!playable) {
      queue.current = [];
      comments.current = [];
      occupied.current = [];
      previous.current = undefined;
      setActive([]);
      return;
    }
    const eligible = (data?.comments ?? []).filter((c) => !c.hidden && !c.deleted);
    const ids = new Set(eligible.map((c) => c.id));
    const oldIds = new Set(comments.current.map((c) => c.id));
    queue.current = [
      ...queue.current.filter((c) => ids.has(c.id)),
      ...shuffledBullets(eligible.filter((c) => !oldIds.has(c.id))),
    ];
    comments.current = eligible;
    setActive((old) => old.filter((c) => ids.has(c.id)));
  }, [playable, data]);
  useEffect(() => {
    if (!playable) return;
    const launch = () => {
      const now = Date.now();
      occupied.current = occupied.current.filter((c) => now - c.started < 7500);
      const lane = freeBulletLane(occupied.current.map((c) => c.lane));
      if (lane === undefined) return;
      if (!queue.current.length)
        queue.current = shuffledBullets(comments.current, previous.current);
      const next = queue.current.shift();
      const bullet = next
        ? {
            ...next,
            lane,
            top: 8 + lane * 21 + Math.random() * 6,
            started: now,
            instance: sequence.current++,
          }
        : null;
      if (bullet) {
        occupied.current.push({ lane, started: now });
        previous.current = bullet.id;
      }
      setActive((old) => [
        ...old.filter((c) => now - c.started < 7500),
        ...(bullet ? [bullet] : []),
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
        <div key={c.instance} className="danmaku-message" style={{ top: `${c.top}%` }}>
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
