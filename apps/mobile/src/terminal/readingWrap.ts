/**
 * Column-accurate wrapping for the reflow presentation.
 *
 * Two problems are solved here, and they turn out to be the same problem.
 *
 * 1. **Fidelity.** A terminal wraps at the column. React Native's `<Text>`
 *    wraps at word boundaries, so a long line full of spaces broke in a shape
 *    the Mac never showed.
 * 2. **Layout stability.** Letting `<Text>` wrap made every list item a
 *    different, *unknown* height. `FlatList` then estimates unmeasured cells
 *    from an average, and re-estimates as they get measured — which moves the
 *    content under a reader who is scrolling up through history. That is the
 *    「向上滚动时画面上下闪烁」 users reported (Mac audit and phone performance
 *    logs both show the frame itself is unchanged during the flicker, so it can
 *    only be the viewport moving).
 *
 * Wrapping here makes every visual line exactly one line tall, which lets the
 * list carry an exact `getItemLayout` and stops estimating altogether.
 *
 * ### Why the phone has to measure width itself
 *
 * `clampGridRowToCols` cuts exactly because the desktop hands it a cell map,
 * but cell maps are not on the wire (`contracts/terminal-grid.schema.json`
 * carries only `column`/`width`/`text`/`style`). So this module re-derives cell
 * widths — and uses `span.width`, the desktop's own accounting, as a
 * **checksum**: when the two disagree the span is not cut at all. A too-long
 * line is cosmetic; a mis-sliced one corrupts the text.
 */

import type { TerminalGridStyle } from '../../../../src/shared/types';

export interface ReadingRun {
  text: string;
  style: TerminalGridStyle;
}

/** A run plus the column count the desktop assigned it. */
export interface MeasuredReadingRun extends ReadingRun {
  width: number;
}

export interface ReadingLine {
  runs: ReadingRun[];
}

/**
 * East Asian Wide and Fullwidth ranges, which a terminal renders two cells wide.
 *
 * This is deliberately the narrow, stable set rather than a full `wcwidth`
 * table: anything it gets wrong is caught by the `span.width` checksum and
 * degrades to "do not cut here", so breadth buys less than predictability.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK Radicals, Kangxi, CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, CJK squared
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms, Small Form Variants
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji pictographs and emoticons
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x20000, 0x2fffd], // CJK Extension B and beyond
  [0x30000, 0x3fffd],
];

export function cellWidthOfCodePoint(codePoint: number): 1 | 2 {
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint < start) break;
    if (codePoint <= end) return 2;
  }
  return 1;
}

/**
 * Per-code-point cell widths for a span, or `null` when they cannot be trusted.
 *
 * `null` means this module's accounting disagreed with the desktop's
 * `span.width` — combining marks, an unlisted wide range, or anything else that
 * makes text length and column count diverge in a way the phone cannot see.
 */
export function spanCellWidths(span: MeasuredReadingRun): number[] | null {
  const widths: number[] = [];
  let total = 0;
  for (const character of span.text) {
    const width = cellWidthOfCodePoint(character.codePointAt(0) ?? 0);
    widths.push(width);
    total += width;
  }
  return total === span.width ? widths : null;
}

/**
 * Splits one logical row into visual lines of at most `columns` cells.
 *
 * Always returns at least one line so list indices stay total — an empty row
 * still occupies a line on screen, exactly as it does in the terminal.
 */
export function wrapReadingRuns(
  runs: readonly MeasuredReadingRun[],
  columns: number,
): ReadingLine[] {
  const budget = Math.max(1, Math.floor(columns));
  const lines: ReadingLine[] = [];
  let current: ReadingRun[] = [];
  let used = 0;
  const flush = (): void => {
    lines.push({ runs: current });
    current = [];
    used = 0;
  };

  for (const run of runs) {
    const widths = spanCellWidths(run);
    if (widths === null) {
      // Cannot cut safely: keep the run whole. It may overrun the budget, which
      // only costs a wider line — the alternative is corrupted text.
      if (used > 0 && used + run.width > budget) flush();
      current.push({ text: run.text, style: run.style });
      used += run.width;
      continue;
    }
    let pending = '';
    let index = 0;
    for (const character of run.text) {
      const width = widths[index] ?? 1;
      index += 1;
      if (used + width > budget && (used > 0 || pending.length > 0)) {
        if (pending.length > 0) current.push({ text: pending, style: run.style });
        pending = '';
        flush();
      }
      pending += character;
      used += width;
    }
    if (pending.length > 0) current.push({ text: pending, style: run.style });
  }
  flush();
  return lines;
}
