'use client';
import { useEffect, useState } from 'react';
import type { Comment } from '@/lib/discussion';
type Data = {
  published: boolean;
  director: boolean;
  globalClosed: boolean;
  closed?: boolean;
  comments: (Omit<Comment, 'author'> & { own: boolean })[];
};
export function BoardDiscussion({ eventId, board }: { eventId: string; board: number }) {
  const url = `/api/events/${eventId}/boards/${board}/discussion`;
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [nickname, setNickname] = useState(''),
    [text, setText] = useState(''),
    [replyTo, setReplyTo] = useState<string>();
  async function load() {
    const r = await fetch(url, { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
  }
  useEffect(() => {
    let current = true;
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        if (current) setData(d);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [url]);
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
  return (
    <section className="panel board-discussion">
      <div className="panel-heading">
        <div>
          <h2>牌局討論</h2>
          <p>打橋牌的人最喜歡大談了！<br />請聚焦本牌，勿張貼敏感個資。</p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setError('');
            load().catch((e) => setError(e.message));
          }}
        >
          更新留言
        </button>
      </div>
      <div className="discussion-body">
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {data?.director && (
          <div className="discussion-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => send('PATCH', { action: 'close', closed: !data.closed })}
            >
              {data.closed ? '開啟本副討論' : '關閉本副討論'}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(data.globalClosed ? '開啟全站討論？' : '關閉全站留言？已有留言仍可閱讀。')
                )
                  send('PATCH', { action: 'global', closed: !data.globalClosed });
              }}
            >
              {data.globalClosed ? '開啟全站討論' : '關閉全站討論'}
            </button>
          </div>
        )}
        {!data && !error && <p>載入留言中…</p>}
        {data && !data.published ? (
          <p>牌型向觀眾公開後，才開放閱讀與留言。</p>
        ) : (
          data && (
            <>
              {data.comments.length === 0 && <p className="muted">目前沒有留言。</p>}
              <ol className="discussion-list">
                {data.comments.map((c) => (
                  <li key={c.id}>
                    <div>
                      <strong>{c.nickname}</strong>{' '}
                      <time dateTime={c.createdAt}>
                        {new Date(c.createdAt).toLocaleString('zh-TW')}
                      </time>
                      {c.hidden && <span> · 已隱藏</span>}
                    </div>
                    {c.replyTo && (
                      <small>
                        回覆：
                        {data.comments.find((r) => r.id === c.replyTo)?.nickname ?? '已移除留言'}
                      </small>
                    )}
                    <p className="discussion-text">{c.text}</p>
                    <div className="discussion-actions">
                      {!data.closed && !data.globalClosed && !c.hidden && (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setReplyTo(c.id)}
                        >
                          回覆
                        </button>
                      )}
                      {(c.own || data.director) && (
                        <button
                          className="button secondary"
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
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              send('PATCH', { action: 'hide', id: c.id, hidden: !c.hidden })
                            }
                          >
                            {c.hidden ? '恢復顯示' : '隱藏'}
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => {
                              if (confirm('封鎖此瀏覽器留言身分？對方更換瀏覽器後仍可能再次留言。'))
                                send('PATCH', { action: 'block', id: c.id, blocked: true });
                            }}
                          >
                            封鎖留言身分
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => {
                              if (confirm('解除此瀏覽器留言身分的封鎖？'))
                                send('PATCH', { action: 'block', id: c.id, blocked: false });
                            }}
                          >
                            解除封鎖
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {data.closed || data.globalClosed ? (
                <p>目前已關閉留言，已有討論仍可閱讀。</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send('POST', { nickname, text, ...(replyTo ? { replyTo } : {}) });
                  }}
                >
                  {replyTo && (
                    <p>
                      回覆 {data.comments.find((c) => c.id === replyTo)?.nickname ?? '留言'}{' '}
                      <button type="button" onClick={() => setReplyTo(undefined)}>
                        取消回覆
                      </button>
                    </p>
                  )}
                  <label className="field">
                    暱稱
                    <input
                      value={nickname}
                      maxLength={30}
                      required
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    留言
                    <textarea
                      rows={4}
                      value={text}
                      maxLength={1000}
                      required
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <p className="footnote">
                    最多 1000 字。每個瀏覽器身分每 10 分鐘最多 5 次、每日 30
                    次發文嘗試；同一網路來源另有限制。同一瀏覽器可刪除自己的留言，清除 Cookie
                    後將失去此權限。
                  </p>
                  <button className="button primary" disabled={busy}>
                    發表留言
                  </button>
                </form>
              )}
            </>
          )
        )}
      </div>
    </section>
  );
}
