'use client';
import { useState } from 'react';
import type { Result, Vulnerability } from '@/lib/model';
import { contractScore } from '@/lib/scoring';
import { ContractEntry } from './contract-entry';
import { applyMiniContract, miniFieldsValue, parsedResult, scoreFormFromResult } from '@/lib/contract-choice';
import { MiniContractFields } from './mini-contract-fields';
import { EditorPopover } from './editor-popover';

export function SplitContractEditor({
  result,
  vulnerability,
  miniBridge,
  disabled,
  names,
  save,
}: {
  result: Result;
  vulnerability: Vulnerability;
  miniBridge: boolean;
  disabled: boolean;
  names: { ns: string; ew: string };
  save: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const [forms, setForms] = useState(() => ({
    ns: { ...scoreFormFromResult(result.split?.ns ?? result), miniBridge },
    ew: { ...scoreFormFromResult(result.split?.ew ?? result), miniBridge },
  }));
  const [reason, setReason] = useState('');
  const ready = { ns: parsedResult(forms.ns), ew: parsedResult(forms.ew) };
  const valid = !!ready.ns && !!ready.ew;
  return (
    <EditorPopover className="split-contract-editor" title={result.split ? '不平衡合約（已套用）' : '裁判判罰：不平衡合約'}>
      <p className="footnote">
        分別指定 NS、EW 獲判的完整合約及實得墩數。雙方各自與另一室比較，分別計算比較分；原始紀錄仍保留。
      </p>
      {(['ns', 'ew'] as const).map((side) => {
        const form = forms[side];
        const saved = parsedResult(form);
        const score = saved ? contractScore(saved, vulnerability, miniBridge) * (side === 'ns' ? 1 : -1) : null;
        return (
          <fieldset key={side}>
            <legend>
              {side.toUpperCase()} · {names[side]}
            </legend>
            {miniBridge && <MiniContractFields value={miniFieldsValue(form)} onChange={(value) => setForms({ ...forms, [side]: applyMiniContract(form, value) })} />}
            <ContractEntry
              value={form.choice}
              disabled={disabled}
              showLevel={!miniBridge}
              showStrain={!miniBridge}
              showDoubled={!miniBridge}
              onChange={(choice) => setForms({ ...forms, [side]: { ...form, choice } })}
            />
            <div className="score-preview" aria-live="polite" aria-atomic="true">
              <span>{side.toUpperCase()} 獲判原始分</span>
              <strong>{score === null ? '—' : `${score > 0 ? '+' : ''}${score}`}</strong>
            </div>
          </fieldset>
        );
      })}
      <label className="field">
        判罰/撤銷原因
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="button-row">
        <button
          type="button"
          className="button subtle"
          disabled={disabled || !valid || reason.trim().length < 2}
          onClick={() => {
            if (!ready.ns || !ready.ew) return;
            void save({
              action: 'split-contract',
              assignmentId: result.assignmentId,
              board: result.board,
              contracts: { ns: ready.ns, ew: ready.ew },
              reason,
            });
          }}
        >
          套用不平衡合約並重算
        </button>
        {result.split && (
          <button
            type="button"
            className="button subtle"
            disabled={disabled || reason.trim().length < 2}
            onClick={() =>
              void save({
                action: 'split-contract',
                assignmentId: result.assignmentId,
                board: result.board,
                contracts: null,
                reason,
              })
            }
          >
            撤銷不平衡合約
          </button>
        )}
      </div>
    </EditorPopover>
  );
}
