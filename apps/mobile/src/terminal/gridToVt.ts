import type {
  TerminalGridColor,
  TerminalGridRow,
  TerminalGridStyle,
} from '../../../../src/shared/types';
import type { ConnectTerminalCommand } from '../../modules/connect-terminal';
import { isCodexInputBackgroundColor } from './terminalAppearance';
import type { NativeTerminalGridState } from './terminalGridModel';

/**
 * Turns the desktop's grid frames into what SwiftTerm draws.
 *
 * The grid carries what the byte stream cannot: the history Connect records
 * for full-screen apps, whose terminal keeps none. Written into SwiftTerm's
 * normal buffer, that history becomes local scrollback — readable without
 * taking the terminal over and scrolled without a round trip per notch.
 *
 * A frame usually extends the last one by a few history rows and a changed
 * canvas; those are written incrementally. Anything else — another panel, a
 * new shape, history that is not a pure extension — rebuilds the whole screen,
 * because a wrong incremental guess would print rows twice.
 */
export interface GridVtState {
  panelId: string;
  cols: number;
  rows: number;
  /** Each screen counts its history separately; the counts do not continue across a switch. */
  screen: 'normal' | 'alternate';
  /** Rows that ever entered history: omitted plus held. */
  historyTotal: number;
  /**
   * The newest history rows (up to three), to prove the next frame continues
   * from them. One row was too little: TUI transcripts are full of blank rows.
   */
  lastHistoryKeys: string[];
  /** The canvas as drawn, row by row, to repaint only what changed. */
  viewportKeys: string[];
  /** History generation drawn (see NativeTerminalGridState.historyGeneration). */
  historyGeneration: number;
}

export interface GridVtPlan {
  commands: ConnectTerminalCommand[];
  next: GridVtState;
  full: boolean;
}

const ESC = '\x1b';
const RESET = `${ESC}[0m`;
/**
 * Auto-wrap off. The desktop and SwiftTerm can disagree on a character's width
 * (newer emoji); with wrap on, a row that then runs one cell over the edge
 * wraps into the next and pushes the whole canvas down. Off, it only clips.
 */
const NO_WRAP = `${ESC}[?7l`;

function colorParams(color: TerminalGridColor | undefined, foreground: boolean): string[] {
  if (color === undefined) return [];
  if (color.kind === 'rgb') {
    const red = (color.value >> 16) & 0xff;
    const green = (color.value >> 8) & 0xff;
    const blue = color.value & 0xff;
    return [foreground ? '38' : '48', '2', String(red), String(green), String(blue)];
  }
  const index = color.index;
  if (index < 8) return [String((foreground ? 30 : 40) + index)];
  if (index < 16) return [String((foreground ? 90 : 100) + index - 8)];
  return [foreground ? '38' : '48', '5', String(index)];
}

export function sgrFor(style: TerminalGridStyle, agent?: 'claude' | 'codex' | 'shell'): string {
  const params = ['0'];
  if (style.bold) params.push('1');
  if (style.dim) params.push('2');
  if (style.italic) params.push('3');
  if (style.underline) params.push('4');
  if (style.inverse) params.push('7');
  if (style.invisible) params.push('8');
  if (style.strikethrough) params.push('9');
  if (style.overline) params.push('53');
  params.push(...colorParams(style.foreground, true));
  // Codex's light input surface reads as a glaring bar on the phone; the other
  // views drop it to the terminal background, and so does this one.
  if (!(agent === 'codex' && isCodexInputBackgroundColor(style.background))) {
    params.push(...colorParams(style.background, false));
  }
  return `${ESC}[${params.join(';')}m`;
}

/** One row from wherever the cursor stands, each span placed at its own column. */
export function rowToVt(row: TerminalGridRow, agent?: 'claude' | 'codex' | 'shell'): string {
  let text = '';
  for (const span of row.spans) {
    // Absolute column per span: SwiftTerm's own idea of a wide character's width
    // cannot drift the rest of the row away from where the desktop put it.
    text += `${ESC}[${span.column + 1}G${sgrFor(span.style, agent)}${span.text}`;
  }
  return `${text}${RESET}`;
}

const CONTINUITY_ROWS = 3;
const rowKeys = (rows: readonly TerminalGridRow[]): string[] => (
  rows.slice(-CONTINUITY_ROWS).map((row) => JSON.stringify(row))
);

function cursorVt(frame: NativeTerminalGridState): string {
  const cursor = frame.cursor;
  if (cursor === undefined) return `${ESC}[?25l`;
  const row = Math.max(0, Math.min(frame.rows - 1, cursor.row));
  const column = Math.max(0, Math.min(frame.cols - 1, cursor.column));
  return `${ESC}[${row + 1};${column + 1}H${ESC}[?25${cursor.visible ? 'h' : 'l'}`;
}

function stateOf(frame: NativeTerminalGridState, viewportKeys: string[]): GridVtState {
  return {
    panelId: frame.panelId,
    cols: frame.cols,
    rows: frame.rows,
    screen: frame.screen,
    historyTotal: frame.omittedLines + frame.historyRows.length,
    lastHistoryKeys: rowKeys(frame.historyRows),
    viewportKeys,
    historyGeneration: frame.historyGeneration ?? 0,
  };
}

export function planGridVt(
  previous: GridVtState | null,
  frame: NativeTerminalGridState,
  agent?: 'claude' | 'codex' | 'shell',
): GridVtPlan {
  const viewportKeys = frame.viewportRows.map((row) => JSON.stringify(row));
  const next = stateOf(frame, viewportKeys);
  const appended = previous === null ? -1 : next.historyTotal - previous.historyTotal;
  const heldBefore = frame.historyRows.length - appended;
  const continues = previous !== null
    && previous.panelId === frame.panelId
    && previous.cols === frame.cols
    && previous.rows === frame.rows
    && previous.screen === frame.screen
    // The desktop resent history whole: its tail can look like an extension
    // (a rewritten transcript keeps most rows), but it is not one.
    && previous.historyGeneration === next.historyGeneration
    && appended >= 0
    && appended <= frame.historyRows.length
    // The rows before the new ones must be the ones drawn last time; otherwise
    // history was replaced, not extended. With nothing left to compare against,
    // only a start from no history is safe.
    && (
      heldBefore <= 0
        ? previous.lastHistoryKeys.length === 0
        : rowKeys(frame.historyRows.slice(0, heldBefore)).join('\n')
          === previous.lastHistoryKeys.slice(-Math.min(CONTINUITY_ROWS, heldBefore)).join('\n')
    );

  if (!continues) {
    let text = `${RESET}${NO_WRAP}${ESC}[?25l`;
    for (const row of frame.historyRows) text += `${rowToVt(row, agent)}\r\n`;
    text += frame.viewportRows.map((row) => rowToVt(row, agent)).join('\r\n');
    text += cursorVt(frame);
    // Rebuilding the panel on screen at the same shape keeps the reader's place
    // in history. A new shape is a new layout: the rows re-wrap, the place no
    // longer exists, and anchoring to it landed on the top row
    // (IPAD-SIDEBAR-SCROLL-TOP-1025, user decision 2026-10-26: open on the newest row).
    const keepScroll = previous !== null
      && previous.panelId === frame.panelId
      && previous.cols === frame.cols
      && previous.rows === frame.rows;
    return {
      commands: [
        { kind: 'reset', keepScroll },
        { kind: 'geometry', cols: frame.cols, rows: frame.rows },
        { kind: 'text', data: text },
      ],
      next,
      full: true,
    };
  }

  let text = `${NO_WRAP}${ESC}[?25l`;
  if (appended > 0) {
    // Paint the rows leaving into the top of the screen, then scroll them off
    // it: they land in scrollback exactly as recorded, sticky headers excluded.
    // Fast output can bring more than a screen at once; it goes a screen at a
    // time instead of forcing a rebuild of the whole history.
    const entering = frame.historyRows.slice(frame.historyRows.length - appended);
    for (let start = 0; start < entering.length; start += frame.rows) {
      const batch = entering.slice(start, start + frame.rows);
      batch.forEach((row, index) => {
        text += `${RESET}${ESC}[${index + 1};1H${ESC}[2K${rowToVt(row, agent)}`;
      });
      text += `${RESET}${ESC}[${frame.rows};1H${'\n'.repeat(batch.length)}`;
    }
  }
  viewportKeys.forEach((key, index) => {
    if (appended === 0 && previous!.viewportKeys[index] === key) return;
    text += `${RESET}${ESC}[${index + 1};1H${ESC}[2K${rowToVt(frame.viewportRows[index]!, agent)}`;
  });
  text += cursorVt(frame);
  return { commands: [{ kind: 'text', data: text }], next, full: false };
}
