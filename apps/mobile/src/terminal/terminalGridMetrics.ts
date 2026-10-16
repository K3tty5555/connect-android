/**
 * Cell metrics for the exact-grid presentation.
 *
 * An alternate-screen app paints a fixed canvas, so its columns cannot be
 * reflowed while staying an exact grid. This mode scales the cell down to fit
 * and pans once that would stop being readable. Font size leads and everything
 * else derives from it, which keeps the metrics out of the
 * cellWidth → fontSize → lineHeight circle.
 *
 * The ratios come from the existing constants: Menlo's advance is 0.6021em
 * (7.25 / 12 = 0.604) and the desktop terminal's line height is 1.4
 * (17 / 12 = 1.417).
 */

import {
  clampTerminalCols,
  clampTerminalRows,
} from '../../../../src/shared/terminalGeometry';

export const GRID_ADVANCE_RATIO = 7.25 / 12;
export const GRID_LINE_HEIGHT_RATIO = 17 / 12;
export const GRID_DEFAULT_FONT_SIZE = 12;
/**
 * Below this the grid stops being readable and scaling gives way to panning.
 *
 * Exact grid is the explicit "I want the desktop layout" choice — the default is
 * reflow, which needs no scaling at all. Fitting a 200-column Mac panel into a
 * phone's 390pt lands at 3.2pt, and the old 6pt floor still produced type nobody
 * could read. Fidelity is worth panning for; it is not worth illegibility.
 */
export const GRID_MIN_FONT_SIZE = 11;

export interface TerminalGridMetrics {
  fontSize: number;
  cellWidth: number;
  lineHeight: number;
  /** The canvas still overflows at the minimum size, so keep horizontal panning. */
  overflows: boolean;
}

/**
 * Geometry this phone can present at the default, desktop-matched cell size.
 *
 * Deliberately independent of the presentation mode and of any scaling: the
 * PTY's shape must not churn when an app enters or leaves the alternate screen,
 * or when a canvas happens to be scaled down to fit.
 *
 * The floor is the shared one: this feeds the takeover-time handover, and a
 * transient narrow layout must not be able to propose a width the CLI would
 * re-lay-out its whole conversation at (dev-log 313).
 */
export function terminalGridViewport(
  width: number,
  height: number,
): { cols: number; rows: number } {
  const cellWidth = GRID_DEFAULT_FONT_SIZE * GRID_ADVANCE_RATIO;
  const lineHeight = Math.round(GRID_DEFAULT_FONT_SIZE * GRID_LINE_HEIGHT_RATIO);
  return {
    cols: clampTerminalCols(Math.floor(width / cellWidth)),
    rows: clampTerminalRows(Math.floor(height / lineHeight)),
  };
}

/** Reflow View type: one wrapped line per list item, exactly this tall. */
export const READING_FONT_SIZE = 13;
export const READING_LINE_HEIGHT = 19;
/** Menlo advance at the reading size; the same ratio the exact grid trusts. */
export const READING_CELL_WIDTH = READING_FONT_SIZE * GRID_ADVANCE_RATIO;
export const READING_PADDING_X = 10;
export const READING_PADDING_TOP = 8;
export const READING_PADDING_BOTTOM = 16;

/**
 * Geometry the Reflow View shows without wrapping anything.
 *
 * Handing the PTY to the phone at exactly this width lets the TUI lay itself
 * out for the phone: every canvas row is one visual line, so the reflow view
 * presents it as the app drew it instead of re-wrapping a desktop-width canvas.
 * Same floor as the exact grid, for the same reason (dev-log 313).
 */
export function terminalReadingViewport(
  width: number,
  height: number,
): { cols: number; rows: number } {
  return {
    cols: clampTerminalCols(Math.floor((width - READING_PADDING_X * 2) / READING_CELL_WIDTH)),
    rows: clampTerminalRows(Math.floor(
      (height - READING_PADDING_TOP - READING_PADDING_BOTTOM) / READING_LINE_HEIGHT,
    )),
  };
}

export function terminalGridMetrics(cols: number, availableWidth: number): TerminalGridMetrics {
  const metricsFor = (fontSize: number): TerminalGridMetrics => ({
    fontSize,
    cellWidth: fontSize * GRID_ADVANCE_RATIO,
    lineHeight: Math.round(fontSize * GRID_LINE_HEIGHT_RATIO),
    overflows: cols * fontSize * GRID_ADVANCE_RATIO > availableWidth + 0.5,
  });
  if (cols <= 0 || availableWidth <= 0) return metricsFor(GRID_DEFAULT_FONT_SIZE);
  // Never scale up past the desktop-matched default; only down to fit.
  const fitted = Math.min(
    GRID_DEFAULT_FONT_SIZE,
    availableWidth / (cols * GRID_ADVANCE_RATIO),
  );
  return metricsFor(Math.max(GRID_MIN_FONT_SIZE, Math.floor(fitted * 100) / 100));
}
