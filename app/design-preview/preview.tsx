'use client';
import { ScoreValue, PairScoreValue } from '@/components/score-value';
import { SuitSymbol } from '@/components/suit-symbol';
import { CommentText } from '@/components/comment-text';
import './preview.css';
export function DesignPreview() {
  return (
    <main className="design-preview">
      <h1>設計預覽</h1>
      <div className="preview-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>分數</h2>
          </div>
          <table>
            <thead>
              <tr>
                <th>種類</th>
                <th>正值</th>
                <th>負值</th>
                <th>缺值</th>
              </tr>
            </thead>
            <tbody>
              {(['mp', 'crossimp', 'butler'] as const).map((method) => (
                <tr key={method}>
                  <th>{method}</th>
                  {[12.7, -2.3, null].map((value, i) => (
                    <td key={i}>
                      <PairScoreValue value={value} top={24} method={method} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th>VP</th>
                <td>
                  <ScoreValue value={12.7} unit="VP" />
                </td>
                <td>
                  <ScoreValue value={0} unit="VP" />
                </td>
                <td>
                  <ScoreValue value={null} unit="VP" />
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <section className="panel preview-pad">
          <h2>累積 MP%</h2>
          <div className="pair-chart-latest">
            <strong>
              <ScoreValue value={50} unit="%" />
            </strong>
          </div>
          <div className="pair-chart-detail gain">
            <dl>
              {[
                ['前值', 49.75, '%'],
                ['本副後', 50, '%'],
                ['全場起伏', 12.5, ''],
                ['最大分差', 10, ''],
              ].map(([label, value, unit]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={label === '本副後' ? 'pair-chart-close' : undefined}>
                    <ScoreValue
                      value={Number(value)}
                      unit={unit as '%' | ''}
                      decimals={label === '最大分差' ? 0 : 2}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <button className="button subtle" popoverTarget="preview-score-details">
            分數明細
          </button>
          <div id="preview-score-details" popover="auto" className="player-detail-popover">
            累積 IMP：
            <ScoreValue value={12.7} unit="IMP" />
            <br />
            調整：
            <ScoreValue value={-0.25} unit="IMP" />
          </div>
        </section>
        <section className="panel preview-pad">
          <h2>花色與身價</h2>
          {['N', 'E'].map((seat, i) => (
            <section key={seat} className="bridge-hand">
              <header className={i ? 'vulnerable' : ''}>
                <button className="hand-perspective-button">
                  <b>{seat}</b>
                  <span className="hand-player-name">{i ? '有身價' : '無身價'}・示範</span>
                </button>
              </header>
              <div className="bridge-suit">
                {['S', 'H', 'D', 'C'].map((suit) => (
                  <b
                    key={suit}
                    data-suit={suit}
                    className={suit === 'H' || suit === 'D' ? 'red' : ''}
                  >
                    <SuitSymbol suit={suit} />
                  </b>
                ))}
              </div>
            </section>
          ))}
          <div className="play-keyboard">
            <div className="play-rack">
              {['S', 'H', 'D', 'C'].map((suit) => (
                <button
                  key={suit}
                  data-suit={suit}
                  className={'rack-card ' + ('HD'.includes(suit) ? 'red-suit' : '')}
                >
                  <SuitSymbol suit={suit} />
                  <b>A</b>
                </button>
              ))}
            </div>
          </div>
          <section className="analysis-corner">
            <strong className="your-contract">
              <span className="contract-bid red-suit">4♥︎</span>
            </strong>
            <table className="compact-dd">
              <thead>
                <tr>
                  {['♣︎', '♦︎', '♥︎', '♠︎', 'NT'].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
            </table>
          </section>
        </section>
        <section className="panel preview-pad">
          <h2>討論與操作</h2>
          <p>
            <strong>北家・示範</strong> · <button className="discussion-action">回覆</button>
          </p>
          <p>
            <CommentText text="比較 !S 與 !H 的配合，再考慮 !D !C。" />
          </p>
          <div className="preview-actions">
            <button className="button">完成覆核</button>
            <button className="button subtle">取消</button>
            <button className="button" disabled>
              處理中
            </button>
          </div>
          <p className="muted">暫計</p>
        </section>
      </div>
    </main>
  );
}
