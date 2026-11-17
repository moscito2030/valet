import type { ResultInput, Seat } from './model';
import { resultSchema } from './model';
import { miniGameLevel } from './scoring';

export type Strain = ResultInput['strain'];
export type Doubled = ResultInput['doubled'];

/** In-progress contract. Null means the scorer has not chosen that part yet. */
export type ContractChoice = {
  level: number | null;
  strain: Strain | null;
  doubled: Doubled | null;
  declarer: Seat | null;
  tricks: number | null;
  lead: string;
};

export type ScoreFormState = {
  assignmentId: string;
  board: number;
  choice: ContractChoice;
  miniBridge?: boolean;
  hcp?: ResultInput['hcp'];
  /** Strain and declarer already stored on a Pass, kept if that Pass is saved again. */
  passDefaults?: { strain: Strain; declarer: Seat };
};

export type StoredContract = {
  level: number;
  strain: Strain;
  doubled: Doubled;
  declarer: Seat;
  tricks: number;
  lead: string;
};

export function emptyContractChoice(): ContractChoice {
  return { level: null, strain: null, doubled: null, declarer: null, tricks: null, lead: '' };
}

export function emptyScoreForm(assignmentId: string, board: number, miniBridge?: boolean): ScoreFormState {
  return {
    assignmentId,
    board,
    choice: emptyContractChoice(),
    ...(typeof miniBridge === 'boolean' ? { miniBridge } : {}),
  };
}

export function choiceFromStored(result: {
  level: number;
  strain: Strain;
  doubled: Doubled;
  declarer: Seat;
  tricks: number;
  lead?: string;
}): ContractChoice {
  const lead = result.lead ?? '';
  if (result.level <= 0) return { level: result.level < 0 ? null : 0, strain: null, doubled: null, declarer: null, tricks: null, lead };
  return {
    level: result.level,
    strain: result.strain,
    doubled: result.doubled,
    declarer: result.declarer,
    tricks: result.tricks,
    lead,
  };
}

export function scoreFormFromResult(result: ResultInput): ScoreFormState {
  return {
    assignmentId: result.assignmentId,
    board: result.board,
    choice: choiceFromStored(result),
    ...(typeof result.miniBridge === 'boolean' ? { miniBridge: result.miniBridge } : {}),
    ...(result.hcp ? { hcp: result.hcp } : {}),
    ...(result.level === 0 ? { passDefaults: { strain: result.strain, declarer: result.declarer } } : {}),
  };
}

export function storedContract(
  choice: ContractChoice,
  options?: { passDefaults?: { strain: Strain; declarer: Seat }; miniBridge?: boolean },
): StoredContract | null {
  if (options?.miniBridge) {
    if (
      choice.level == null ||
      choice.level < 1 ||
      !choice.strain ||
      !choice.declarer ||
      choice.tricks == null ||
      (choice.level !== 1 && choice.level !== miniGameLevel(choice.strain))
    )
      return null;
    return {
      level: choice.level,
      strain: choice.strain,
      doubled: 1,
      declarer: choice.declarer,
      tricks: choice.tricks,
      lead: choice.lead,
    };
  }
  if (choice.level === 0) {
    return {
      level: 0,
      strain: choice.strain ?? options?.passDefaults?.strain ?? 'NT',
      doubled: 1,
      declarer: choice.declarer ?? options?.passDefaults?.declarer ?? 'N',
      tricks: 0,
      lead: choice.lead,
    };
  }
  if (
    choice.level == null ||
    choice.level < 1 ||
    choice.level > 7 ||
    !choice.strain ||
    !choice.doubled ||
    !choice.declarer ||
    choice.tricks == null ||
    choice.tricks < 0 ||
    choice.tricks > 13
  )
    return null;
  return {
    level: choice.level,
    strain: choice.strain,
    doubled: choice.doubled,
    declarer: choice.declarer,
    tricks: choice.tricks,
    lead: choice.lead,
  };
}

export function asResult(fields: StoredContract, form: Pick<ScoreFormState, 'assignmentId' | 'board' | 'miniBridge' | 'hcp'>): ResultInput {
  return {
    assignmentId: form.assignmentId,
    board: form.board,
    ...fields,
    ...(typeof form.miniBridge === 'boolean' ? { miniBridge: form.miniBridge } : {}),
    ...(form.hcp ? { hcp: form.hcp } : {}),
  };
}

/** A result the API can store. Incomplete choices and invalid point counts stay null. */
export function parsedResult(form: ScoreFormState): ResultInput | null {
  const fields = storedContract(form.choice, { passDefaults: form.passDefaults, miniBridge: form.miniBridge });
  if (!fields || !form.assignmentId) return null;
  const parsed = resultSchema.safeParse(asResult(fields, form));
  return parsed.success ? parsed.data : null;
}

export function miniFieldsValue(form: ScoreFormState): ResultInput {
  return {
    assignmentId: form.assignmentId || 'draft',
    board: form.board || 1,
    level: form.choice.level ?? -1,
    strain: form.choice.strain ?? 'NT',
    doubled: 1,
    declarer: form.choice.declarer ?? 'N',
    tricks: form.choice.tricks ?? 0,
    lead: form.choice.lead,
    miniBridge: true,
    ...(form.hcp ? { hcp: form.hcp } : {}),
  };
}

export function applyHcp(form: ScoreFormState, next: ResultInput): ScoreFormState {
  const hcp = next.hcp && Object.keys(next.hcp).length ? next.hcp : undefined;
  return hcp ? { ...form, hcp } : { ...form, hcp: undefined };
}

export function applyMiniContract(form: ScoreFormState, next: ResultInput): ScoreFormState {
  const level = next.level > 0 ? next.level : null;
  const strain = level == null ? null : next.strain;
  return {
    ...form,
    miniBridge: true,
    choice: {
      ...form.choice,
      level,
      strain,
      doubled: null,
      tricks: form.choice.level === level ? form.choice.tricks : null,
    },
  };
}

/** Five relative results. Page 0 is −2…+2; negative pages step down by five, positive pages step up. */
export function trickDeltas(page: number): number[] {
  const start = page < 0 ? -2 + page * 5 : page > 0 ? 3 + (page - 1) * 5 : -2;
  return [0, 1, 2, 3, 4].map((offset) => start + offset);
}

export function deltaBounds(level: number): { min: number; max: number } {
  return { min: -(level + 6), max: 13 - (level + 6) };
}

export function deltaPossible(level: number, delta: number): boolean {
  const { min, max } = deltaBounds(level);
  return delta >= min && delta <= max;
}

export function possibleDeltas(level: number, page: number): number[] {
  return trickDeltas(page).filter((delta) => deltaPossible(level, delta));
}

export function canShiftTricks(level: number | null, page: number, direction: -1 | 1): boolean {
  return level != null && level > 0 && possibleDeltas(level, page + direction).length > 0;
}

export function pageForDelta(delta: number): number {
  if (delta >= -2 && delta <= 2) return 0;
  if (delta < -2) return -1 - Math.floor((-3 - delta) / 5);
  return 1 + Math.floor((delta - 3) / 5);
}

export function formatDelta(delta: number): string {
  if (delta === 0) return '=';
  return delta > 0 ? `+${delta}` : `−${-delta}`;
}

export function formatDeltaSpan(deltas: number[]): string {
  if (deltas.length === 0) return '—';
  if (deltas.length === 1) return formatDelta(deltas[0]);
  return `${formatDelta(deltas[0])}…${formatDelta(deltas[deltas.length - 1])}`;
}

export function trickRange(level: number | null, page: number, tricks: number | null): { window: string; held: string | null } {
  if (level == null || level < 1) return { window: '', held: null };
  const window = formatDeltaSpan(possibleDeltas(level, page));
  if (tricks == null) return { window, held: null };
  const delta = tricks - level - 6;
  if (trickDeltas(page).includes(delta) && deltaPossible(level, delta)) return { window, held: null };
  return { window, held: formatDelta(delta) };
}

export function tricksForDelta(level: number, delta: number): number {
  return level + 6 + delta;
}
