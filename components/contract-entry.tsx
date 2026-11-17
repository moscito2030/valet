'use client';
import {
  canShiftTricks,
  deltaPossible,
  formatDelta,
  formatDeltaSpan,
  pageForDelta,
  possibleDeltas,
  trickDeltas,
  trickRange,
  tricksForDelta,
  type ContractChoice,
  type Strain,
} from '@/lib/contract-choice';
import type { Seat } from '@/lib/model';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SuitSymbol } from './suit-symbol';

const levels = [
  { id: '0', label: 'Pass', text: 'Pass' },
  ...[1, 2, 3, 4, 5, 6, 7].map((level) => ({ id: String(level), label: `${level} 階`, text: String(level) })),
];
const suits: { id: Strain; label: string; text: ReactNode; suit: string }[] = [
  { id: 'C', label: '梅花', text: <SuitSymbol suit="C" />, suit: 'C' },
  { id: 'D', label: '方塊', text: <SuitSymbol suit="D" />, suit: 'D' },
  { id: 'H', label: '紅心', text: <SuitSymbol suit="H" />, suit: 'H' },
  { id: 'S', label: '黑桃', text: <SuitSymbol suit="S" />, suit: 'S' },
  { id: 'NT', label: '無將', text: 'NT', suit: 'NT' },
];
const seats: { id: Seat; label: string; text: string }[] = [
  { id: 'N', label: '北', text: 'N' },
  { id: 'E', label: '東', text: 'E' },
  { id: 'S', label: '南', text: 'S' },
  { id: 'W', label: '西', text: 'W' },
];
const doubles = [
  { id: '1', label: '未加倍', text: '無' },
  { id: '2', label: '加倍', text: 'x' },
  { id: '4', label: '再加倍', text: 'xx' },
];

function moveRadio(event: KeyboardEvent<HTMLDivElement>) {
  const key = event.key;
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(key)) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  if (!buttons.length) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const last = buttons.length - 1;
  const next =
    key === 'Home' ? 0
    : key === 'End' ? last
    : key === 'ArrowRight' || key === 'ArrowDown' ? (current < 0 ? 0 : (current + 1) % buttons.length)
    : current < 0 ? last
    : (current - 1 + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next].focus();
  buttons[next].click();
}

function ChipRow({
  label,
  className,
  options,
  selected,
  disabled,
  onSelect,
}: {
  label: string;
  className: string;
  options: { id: string; label: string; text: ReactNode; suit?: string; disabled?: boolean }[];
  selected: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  const labelId = useId();
  const selectedIndex = options.findIndex((option) => option.id === selected && !option.disabled);
  const firstEnabled = options.findIndex((option) => !disabled && !option.disabled);
  const separatePass = className === 'levels';
  const pass = separatePass ? options.find((option) => option.id === '0') : undefined;
  const rowOptions = pass ? options.filter((option) => option.id !== '0') : options;
  function chip(option: (typeof options)[number], index: number) {
    const optionDisabled = !!disabled || !!option.disabled;
    const checked = option.id === selected && !option.disabled;
    const tabIndex = optionDisabled ? -1 : selectedIndex >= 0 ? (index === selectedIndex ? 0 : -1) : index === firstEnabled ? 0 : -1;
    return (
      <button
        key={option.id}
        type="button"
        role="radio"
        className={option.id === '0' ? 'contract-chip contract-pass' : 'contract-chip'}
        aria-checked={checked}
        aria-label={option.label}
        disabled={optionDisabled}
        tabIndex={tabIndex}
        data-suit={option.suit}
        onClick={() => onSelect(option.id)}
      >
        <span aria-hidden="true">{option.text}</span>
      </button>
    );
  }
  return (
    <div className={`contract-group${disabled ? ' is-inactive' : ''}`}>
      <div className="contract-group-label" id={labelId}>{label}</div>
      <div role="radiogroup" aria-labelledby={labelId} className={separatePass ? 'contract-level-set' : `contract-chip-row ${className}`} onKeyDown={moveRadio}>
        {pass && chip(pass, options.findIndex((option) => option.id === pass.id))}
        {separatePass ? <div className="contract-chip-row levels">{rowOptions.map((option) => chip(option, options.findIndex((item) => item.id === option.id)))}</div> : rowOptions.map((option, index) => chip(option, index))}
      </div>
    </div>
  );
}

function initialPage(value: ContractChoice): number {
  if (value.level == null || value.level < 1 || value.tricks == null) return 0;
  return pageForDelta(value.tricks - value.level - 6);
}

export function ContractEntry({
  value,
  onChange,
  disabled = false,
  showLevel = true,
  showStrain = true,
  showDeclarer = true,
  showDoubled = true,
  showTricks = true,
  doubledLabel = '賭倍',
}: {
  value: ContractChoice;
  onChange: (value: ContractChoice) => void;
  disabled?: boolean;
  showLevel?: boolean;
  showStrain?: boolean;
  showDeclarer?: boolean;
  showDoubled?: boolean;
  showTricks?: boolean;
  doubledLabel?: string;
}) {
  const trickLabel = useId();
  const rangeId = useId();
  const [page, setPage] = useState(() => initialPage(value));
  const previousLevel = useRef(value.level);
  useEffect(() => {
    if (previousLevel.current === value.level) return;
    previousLevel.current = value.level;
    if (value.level != null && value.level > 0 && value.tricks != null) setPage(pageForDelta(value.tricks - value.level - 6));
    else setPage(0);
  }, [value.level, value.tricks]);

  const contractLevel = value.level != null && value.level > 0 ? value.level : null;
  const open = !disabled && contractLevel != null;
  const deltas = trickDeltas(contractLevel ? page : 0);
  const range = trickRange(contractLevel, page, value.tricks);
  const previous = contractLevel ? possibleDeltas(contractLevel, page - 1) : [];
  const next = contractLevel ? possibleDeltas(contractLevel, page + 1) : [];
  const selectedTrick = deltas.findIndex((delta) => contractLevel != null && value.tricks === tricksForDelta(contractLevel, delta) && deltaPossible(contractLevel, delta));
  const firstTrick = deltas.findIndex((delta) => contractLevel != null && deltaPossible(contractLevel, delta));

  function chooseLevel(nextLevel: number) {
    if (disabled || nextLevel === value.level) return;
    setPage(0);
    onChange({ ...value, level: nextLevel, tricks: null });
  }

  return (
    <div className="contract-entry">
      {showLevel && (
        <ChipRow
          label="線位"
          className="levels"
          options={levels}
          selected={value.level == null ? null : String(value.level)}
          disabled={disabled}
          onSelect={(id) => chooseLevel(Number(id))}
        />
      )}
      {showStrain && (
        <ChipRow
          label="合約花色"
          className="suits"
          options={suits}
          selected={contractLevel ? value.strain : null}
          disabled={!open}
          onSelect={(id) => onChange({ ...value, strain: id as Strain })}
        />
      )}
      {showDeclarer && (
        <ChipRow
          label="莊家"
          className="seats"
          options={seats}
          selected={contractLevel ? value.declarer : null}
          disabled={!open}
          onSelect={(id) => onChange({ ...value, declarer: id as Seat })}
        />
      )}
      {showDoubled && (
        <ChipRow
          label={doubledLabel}
          className="doubles"
          options={doubles}
          selected={contractLevel && value.doubled ? String(value.doubled) : null}
          disabled={!open}
          onSelect={(id) => onChange({ ...value, doubled: Number(id) as 1 | 2 | 4 })}
        />
      )}
      {showTricks && (
        <div className={`contract-group${open ? '' : ' is-inactive'}`}>
          <div className="contract-group-label" id={trickLabel}>
            <span>實得墩數</span>
            {contractLevel != null && (
              <span className="contract-range" id={rangeId} aria-live="polite">
                {range.window}
                {range.held && <span className="contract-held"> · 已選 {range.held}</span>}
              </span>
            )}
          </div>
          <div className="contract-trick-row">
            <button
              type="button"
              className="contract-chip contract-pager"
              aria-label={previous.length ? `顯示 ${formatDeltaSpan(previous)}` : '沒有更宕的結果'}
              disabled={disabled || !canShiftTricks(contractLevel, page, -1)}
              onClick={() => setPage((current) => current - 1)}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <div
              role="radiogroup"
              className="contract-trick-values"
              aria-labelledby={trickLabel}
              aria-describedby={contractLevel != null ? rangeId : undefined}
              onKeyDown={moveRadio}
            >
              {deltas.map((delta, index) => {
                const possible = contractLevel != null && deltaPossible(contractLevel, delta);
                const tricks = contractLevel == null ? null : tricksForDelta(contractLevel, delta);
                const checked = possible && value.tricks === tricks;
                const tabIndex = !possible || disabled ? -1 : selectedTrick >= 0 ? (index === selectedTrick ? 0 : -1) : index === firstTrick ? 0 : -1;
                return (
                  <button
                    key={delta}
                    type="button"
                    role="radio"
                    className="contract-chip"
                    aria-checked={checked}
                    aria-label={trickName(contractLevel, delta)}
                    disabled={!possible || disabled}
                    tabIndex={tabIndex}
                    onClick={() => contractLevel != null && onChange({ ...value, tricks: tricksForDelta(contractLevel, delta) })}
                  >
                    <span aria-hidden="true">{formatDelta(delta)}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="contract-chip contract-pager"
              aria-label={next.length ? `顯示 ${formatDeltaSpan(next)}` : '沒有更超的結果'}
              disabled={disabled || !canShiftTricks(contractLevel, page, 1)}
              onClick={() => setPage((current) => current + 1)}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function trickName(level: number | null, delta: number): string {
  const mark = formatDelta(delta);
  if (level == null || !deltaPossible(level, delta)) return level == null ? mark : `${mark}，不可能`;
  const tricks = tricksForDelta(level, delta);
  if (delta === 0) return `剛好完成，${tricks} 墩`;
  return delta < 0 ? `宕 ${-delta} 墩，${tricks} 墩` : `超 ${delta} 墩，${tricks} 墩`;
}
