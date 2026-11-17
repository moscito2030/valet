/** Fit one suit line inside its cell without changing the font height. */

export type RankLineFit = { slot: number | null; scale: number };

/** Horizontal scale that keeps `needed` inside `available`. Height is untouched. */
export function rankLineScale(needed: number, available: number): number {
  if (!Number.isFinite(needed) || !Number.isFinite(available) || needed <= 0 || available <= 0)
    return 1;
  if (needed <= available) return 1;
  return Math.min(1, Math.max(0.01, Math.floor((available / needed) * 1000) / 1000));
}

/**
 * `natural` is the line width at the normal card slot.
 * `glyphLine` is the width if each rank keeps its own advance and the extra slot padding is removed.
 * Lines that already fit return the stylesheet slot and scale 1.
 * Overflowing lines drop slot padding first, then scaleX only the remainder.
 */
export function fitRankLine(
  natural: number,
  glyphLine: number,
  available: number,
  count: number,
): RankLineFit {
  if (
    !Number.isFinite(natural) ||
    !Number.isFinite(available) ||
    !Number.isFinite(count) ||
    !(natural > 0) ||
    !(available > 0) ||
    !(count > 0) ||
    natural <= available
  ) {
    return { slot: null, scale: 1 };
  }
  const room = Math.max(1, available - 1);
  const glyphs = Number.isFinite(glyphLine) ? glyphLine : 0;
  if (!(glyphs > 0) || glyphs >= natural)
    return { slot: null, scale: rankLineScale(natural, room) };
  if (glyphs <= room) return { slot: room / count, scale: 1 };
  return { slot: glyphs / count, scale: rankLineScale(glyphs, room) };
}

function glyphAdvance(sample: HTMLElement, cache: Map<string, number>): number {
  const style = getComputedStyle(sample);
  const key = [style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing].join('|');
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const probe = document.createElement('span');
  probe.textContent = 'AKQJT98765432';
  probe.style.cssText =
    'position:absolute;left:-9999px;top:0;white-space:nowrap;font-variant-ligatures:none;';
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStyle = style.fontStyle;
  probe.style.letterSpacing = style.letterSpacing;
  probe.style.fontVariantNumeric = style.fontVariantNumeric;
  probe.style.fontFeatureSettings = style.fontFeatureSettings;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width / 13;
  probe.remove();
  cache.set(key, width);
  return width;
}

function writeFit(line: HTMLElement, fit: RankLineFit) {
  if (fit.slot == null) line.style.removeProperty('--rank-slot');
  else line.style.setProperty('--rank-slot', `${fit.slot.toFixed(3)}px`);
  if (fit.scale === 1) line.style.removeProperty('--rank-scale');
  else line.style.setProperty('--rank-scale', fit.scale.toFixed(3));
}

let fitting = false;

/** Measure suit lines under `root` and narrow only the ones that leave their cell. */
export function applyRankLineFits(root: ParentNode) {
  if (fitting || typeof document === 'undefined') return;
  const lines = [...root.querySelectorAll<HTMLElement>('.bridge-ranks > .rank-string')];
  if (!lines.length) return;
  fitting = true;
  try {
    for (const line of lines) {
      line.style.setProperty('--rank-scale', '1');
      line.style.removeProperty('--rank-slot');
    }
    const glyphs = new Map<string, number>();
    for (const line of lines) {
      const container = line.parentElement;
      if (!(container instanceof HTMLElement)) continue;
      const cards = [...line.children].filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      const natural = cards.reduce((sum, card) => sum + card.offsetWidth, 0);
      const advance = cards.length ? glyphAdvance(cards[0], glyphs) : 0;
      writeFit(
        line,
        fitRankLine(natural, advance * cards.length, container.clientWidth, cards.length),
      );
    }
  } finally {
    fitting = false;
  }
}
