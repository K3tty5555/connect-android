/**
 * The shape a shared PTY is allowed to take.
 *
 * A terminal panel narrower than a CLI can draw in is not a narrow terminal —
 * it is a destroyed transcript. Claude Code and Codex wrap their own output, so
 * the width they are told about is the width their *whole* conversation is
 * re-laid-out at, and Connect records the rows that leave the canvas as the
 * phone's history. A Dockview group squeezed to its 100px minimum (12 windows
 * in a 1246px frame) proposes nine columns; the desktop recovers the moment the
 * panel is widened again, but the rows recorded meanwhile stay nine columns
 * wide forever — which is what the phone kept showing (dev-log 313).
 *
 * So the floor is not cosmetic: below it the panel clips horizontally (and
 * un-clips as soon as it is widened) instead of reshaping the session. The
 * value is the user's call of 2026-09-13 — 32 columns, which leaves today's
 * four-panel layout (38 columns) untouched and still gives the phone 16 CJK
 * characters per line at the floor.
 *
 * Rows deliberately keep their existing lower bound: a short canvas scrolls
 * more rows into history, but it never changes what a row *contains*.
 */

export const TERMINAL_MIN_COLS = 32;
export const TERMINAL_MAX_COLS = 500;
export const TERMINAL_MIN_ROWS = 1;
export const TERMINAL_MAX_ROWS = 200;

/** Fits a proposed column count into the range a CLI can actually render in. */
export function clampTerminalCols(cols: number): number {
  return Math.max(TERMINAL_MIN_COLS, Math.min(TERMINAL_MAX_COLS, cols));
}

/** Fits a proposed row count into the contract's range. */
export function clampTerminalRows(rows: number): number {
  return Math.max(TERMINAL_MIN_ROWS, Math.min(TERMINAL_MAX_ROWS, rows));
}

/**
 * How much scrollback a grid frame may carry to the phone.
 *
 * The phone keeps only the newest rows — `applyTerminalGridFrame` slices to
 * `maxHistoryRows` and folds whatever it dropped into `omittedLines` — so every
 * row the desktop sends beyond this bound is decoded, decrypted and thrown away.
 * On a fast link that waste is invisible. On a degraded relay it is fatal: the
 * first frame after an attach is the largest one, it is all-or-nothing, and a
 * connection that dies before it lands starts the whole transfer over (see
 * `dev-log/339`). Bounding it desktop-side is free — the phone's visible history
 * is identical either way, and `omittedLines` already states the truth.
 */
export const MOBILE_GRID_MAX_HISTORY_ROWS = 2_000;

/**
 * Trims a grid frame's history to the bound and states the loss.
 *
 * `omittedLines` is added to, never replaced: the mirror may already have
 * dropped rows of its own, and reporting only this trim would claim those back.
 */
export function boundGridHistory<Row>(
  historyRows: readonly Row[],
  omittedLines: number,
  maxRows = MOBILE_GRID_MAX_HISTORY_ROWS,
): { historyRows: Row[]; omittedLines: number } {
  if (historyRows.length <= maxRows) return { historyRows: [...historyRows], omittedLines };
  return {
    historyRows: historyRows.slice(-maxRows),
    omittedLines: omittedLines + (historyRows.length - maxRows),
  };
}
