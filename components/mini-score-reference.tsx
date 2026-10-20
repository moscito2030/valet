'use client';
import { SuitSymbol } from './suit-symbol';
import { useId } from 'react';
import { Table2, X } from 'lucide-react';
import type { ResultInput } from '@/lib/model';
import { contractScore, miniGameLevel } from '@/lib/scoring';

const suits = [['C', '♣'], ['D', '♦'], ['H', '♥'], ['S', '♠'], ['NT', 'NT']] as const;
export function MiniScoreReference({ value, inline = false }: { value?: ResultInput | null; inline?: boolean }) {
  const id = useId();
  return <><button type="button" className={inline ? 'mini-score-inline-trigger' : 'button subtle mini-score-trigger'} popoverTarget={id}>{!inline && <Table2 size={16} />}合約分數表</button>
  <section id={id} popover="auto" role="dialog" className="mini-score-reference mini-score-popover" aria-label="迷你橋牌合約分數表">
    <button type="button" className="icon-button mini-score-close" aria-label="關閉合約分數表" popoverTarget={id} popoverTargetAction="hide"><X size={18} /></button>
    <div className="mini-score-heading"><div><span className="eyebrow">MINIBRIDGE</span><h3>合約分數表</h3></div><span className="mini-score-badge">無身價 · 不加倍</span></div>
    <p>以莊家方得分為準，下表為剛好完成合約的分數。</p>
    <table><thead><tr><th scope="col">花色</th><th scope="col">一線 · 7 墩</th><th scope="col">成局</th><th scope="col">每超一墩</th></tr></thead>
      <tbody>{suits.map(([strain, symbol]) => <tr key={strain}>
        <th scope="row" data-suit={strain} className={strain === 'D' || strain === 'H' ? 'mini-red-suit' : ''}><SuitSymbol suit={strain} /></th>
        {([1, miniGameLevel(strain)]).map(level => {
          const score = contractScore({assignmentId:'reference',board:1,strain,level,declarer:'N',doubled:1,tricks:level+6,lead:'',miniBridge:true}, 'None', true);
          const selected = value?.strain === strain && value.level === level;
          return <td key={level} className={selected ? 'mini-score-selected' : ''}><span className="mini-score-contract">{level}{symbol}{level > 1 && <small> · {level + 6} 墩</small>}</span><strong>+{score}</strong>{selected && <span className="mini-score-current">目前合約</span>}</td>;
        })}<td className="mini-overtrick">+{strain === 'C' || strain === 'D' ? 20 : 30}</td>
      </tr>)}</tbody>
    </table>
    <div className="mini-score-note"><strong>未完成合約</strong><span aria-hidden="true">·</span><span>每少一墩 <span className="mini-score-penalty">−50 分</span></span></div>
    <p className="mini-score-footnote">一線合約即使取得成局墩數，仍按一線計分。NS／EW 的正負號依莊家方向換算。</p>
  </section></>;
}
