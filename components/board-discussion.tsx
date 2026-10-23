'use client';
import { useState, useRef, useId, useEffect } from 'react';
import {
  Reply,
  Send,
  X,
  MessageSquare,
} from 'lucide-react';
import { discussionThreads } from '@/lib/discussion-threads';
import type { CSSProperties } from 'react';
import { CommentText } from './comment-text';
import { useDiscussion } from './board-discussion-context';
export function BoardDiscussion({ eventId, board }: { eventId: string; board: number }) {
  const composer = useRef<HTMLTextAreaElement>(null);
  const menuId = useId();
  const url = `/api/events/${eventId}/boards/${board}/discussion`;
  const { data, error, setError, refresh: load } = useDiscussion();
  const [busy, setBusy] = useState(false);
  const locatedHash = useRef('');
  useEffect(() => {
    const locate = () => {
      const hash = window.location.hash;
      if (!hash.startsWith('#comment-') || hash === locatedHash.current) return;
      const comment = data?.comments.find(c => '#comment-' + c.id === hash);
      if (!comment || !data?.published) return;
      const target = document.getElementById('comment-' + comment.id);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
        locatedHash.current = hash;
      }
    };
    locate();
    window.addEventListener('hashchange', locate);
    return () => window.removeEventListener('hashchange', locate);
  }, [data]);
  const [nickname, setNickname] = useState(''),
    [text, setText] = useState(''),
    [replyTo, setReplyTo] = useState<string>();
  async function send(method: string, body: object) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (method === 'POST') {
        setText('');
        setReplyTo(undefined);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const replying = data?.comments.find((c) => c.id === replyTo);
  function beginReply(id: string) {
    setReplyTo(id);
    composer.current?.focus({ preventScroll: true });
    composer.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  return (
    <section className="panel board-discussion">
      <div className="panel-heading discussion-heading">
        <div>
          <h3>牌局討論</h3>
            {data?.director && (
              <button
                type="button"
                className="discussion-action discussion-close-control"
                disabled={busy}
                onClick={() => send('PATCH', { action: 'close', closed: !data.closed })}
              >
                {data.closed ? '開啟本副討論' : '關閉本副討論'}
              </button>
            )}
        </div>
      </div>
      <div className="discussion-body">
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {!data && !error && <p className="discussion-status">載入留言中…</p>}
        {data && !data.published ? (
          <p className="discussion-status">牌型向觀眾公開後，才開放閱讀與留言。</p>
        ) : (
          data && (
            <>
              {data.comments.length === 0 && (
                <div className="discussion-empty">
                  <MessageSquare size={22} aria-hidden="true" />
                  <p>還沒有討論，來聊聊這副牌吧。</p>
                </div>
              )}
              <ol className="discussion-list">
                {discussionThreads(data.comments).map(({ comment: c, depth, lastReply }) => (
                  <li key={c.id} id={`comment-${c.id}`} tabIndex={-1} className={`discussion-comment${depth > 0 ? ' discussion-thread-reply' : ''}${lastReply ? ' discussion-thread-last' : ''}${c.hidden ? ' discussion-hidden' : ''}`} style={{ '--reply-depth': Math.min(depth, 3), '--reply-depth-mobile': Math.min(depth, 2) } as CSSProperties}>
                    <div className="discussion-meta">
                      <strong>{c.nickname}</strong>
                      {!data.closed && !data.globalClosed && !c.hidden && (
                        <button
                          type="button"
                          className="button subtle discussion-action"
                          disabled={busy}
                          onClick={() => beginReply(c.id)}
                        >
                          回覆
                        </button>
                      )}
                      {(c.own || data.director) && (
                        <button
                          className="button subtle discussion-action discussion-delete"
                          disabled={busy}
                          onClick={() => {
                            if (confirm('刪除此留言？'))
                              send('PATCH', { action: 'delete', id: c.id });
                          }}
                        >
                          刪除
                        </button>
                      )}
                      {data.director && (
                        <>
                          <button
                            className="button subtle discussion-action"
                            popoverTarget={`${menuId}-${c.id}`}
                            aria-label={`管理 ${c.nickname} 的留言`}
                          >
                            <span>管理</span>
                          </button>
                          <div id={`${menuId}-${c.id}`} popover="auto" className="discussion-menu">
                            <div className="discussion-menu-heading">
                              <strong>管理 {c.nickname} 的留言</strong>
                              <button
                                className="button subtle discussion-action"
                                popoverTarget={`${menuId}-${c.id}`}
                                popoverTargetAction="hide"
                                aria-label="關閉留言管理"
                              >
                                <X size={16} />
                              </button>
                            </div>
                            <button
                              disabled={busy}
                              onClick={() =>
                                send('PATCH', { action: 'hide', id: c.id, hidden: !c.hidden })
                              }
                            >
                              {c.hidden ? '恢復顯示' : '隱藏留言'}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (
                                  confirm('封鎖此瀏覽器留言身分？對方更換瀏覽器後仍可能再次留言。')
                                )
                                  send('PATCH', { action: 'block', id: c.id, blocked: true });
                              }}
                            >
                              封鎖留言身分
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (confirm('解除此瀏覽器留言身分的封鎖？'))
                                  send('PATCH', { action: 'block', id: c.id, blocked: false });
                              }}
                            >
                              解除封鎖
                            </button>
                          </div>
                        </>
                      )}
                      <a className="discussion-permalink" href={`/?event=${encodeURIComponent(eventId)}&view=boards&board=${board}#comment-${c.id}`} aria-label={`連結至 ${c.nickname} 的留言`} title="留言專屬連結，可複製或分享">
                      <time dateTime={c.createdAt}>
                        {new Date(c.createdAt).toLocaleString('zh-TW', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </time>
                      </a>
                      {c.hidden && <span className="discussion-badge">已隱藏</span>}

                    </div>
                    {c.replyTo && (depth === 0 || depth > 3) && (
                      <div className="discussion-reference">
                        <Reply size={13} aria-hidden="true" />
                        回覆{' '}
                        {data.comments.find((r) => r.id === c.replyTo)?.nickname ?? '已移除留言'}
                      </div>
                    )}
                    <p className="discussion-text">
                      <CommentText text={c.text} />
                    </p>

                  </li>
                ))}
              </ol>
              {data.closed || data.globalClosed ? (
                <p className="discussion-status">目前已關閉留言，已有討論仍可閱讀。</p>
              ) : (
                <form
                  className="discussion-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send('POST', { nickname, text, ...(replyTo ? { replyTo } : {}) });
                  }}
                >
                  <h3>{replyTo ? '回覆留言' : '加入討論'}</h3>
                  {replyTo && (
                    <div className="discussion-reply-context" role="status">
                      <div>
                        <span>回覆 {replying?.nickname ?? '留言'}</span>
                        <p>
                          <CommentText text={replying?.text ?? '原留言已移除'} />
                        </p>
                      </div>
                      <button
                        type="button"
                        className="button subtle discussion-action"
                        onClick={() => setReplyTo(undefined)}
                        aria-label="取消回覆"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <label className="field discussion-nickname">
                    暱稱
                    <input
                      value={nickname}
                      maxLength={30}
                      required
                      placeholder="你希望大家怎麼稱呼你？"
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    留言
                    <textarea
                      ref={composer}
                      rows={3}
                      value={text}
                      maxLength={1000}
                      required
                      placeholder={replyTo ? '寫下你的回覆…' : '這副牌，你會怎麼打？'}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <div className="discussion-compose-footer">
                    <span className="discussion-count">{text.length} / 1000</span>
                    <button className="button subtle discussion-submit" disabled={busy}>
                      <Send size={15} aria-hidden="true" />
                      {busy ? '送出中…' : replyTo ? '送出回覆' : '發表留言'}
                    </button>
                  </div>
                  <p className="footnote discussion-help">
                    請勿張貼敏感個資。花色可輸入 !s !h !d !c（♠ ♥ ♦ ♣），大小寫皆可。
                    <br />每 10 分鐘最多 5 次、每日 30
                    次發文嘗試；同一網路來源另有限制。同一瀏覽器可刪除自己的留言，清除 Cookie
                    後將失去此權限。
                  </p>
                </form>
              )}
            </>
          )
        )}
      </div>
    </section>
  );
}
