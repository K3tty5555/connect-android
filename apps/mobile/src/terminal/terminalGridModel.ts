import type {
  TerminalGridFrame,
  TerminalGridRow,
} from '../../../../src/shared/types';

export interface NativeTerminalGridState {
  panelId: string;
  revision: number;
  upperSeq: number;
  cols: number;
  rows: number;
  screen: 'normal' | 'alternate';
  omittedLines: number;
  historyRows: TerminalGridRow[];
  viewportRows: TerminalGridRow[];
  cursor?: { row: number; column: number; visible: boolean };
  /**
   * Bumped by every full frame. The desktop sends one whenever it could not
   * extend history (a TUI rewriting its transcript, a resize, a buffer switch),
   * so a renderer that drew the last generation must rebuild, not extend.
   */
  historyGeneration?: number;
}

export type TerminalGridApplyResult =
  | { kind: 'applied'; state: NativeTerminalGridState }
  | { kind: 'stale'; state: NativeTerminalGridState }
  | { kind: 'recovery_required' };

export function applyTerminalGridFrame(
  current: NativeTerminalGridState | null,
  frame: TerminalGridFrame,
  maxHistoryRows = 2_000,
): TerminalGridApplyResult {
  if (current !== null && frame.revision <= current.revision) {
    return { kind: 'stale', state: current };
  }
  if (frame.full) {
    // Alternate-screen history is Connect's own record of rows that left the
    // canvas, not terminal scrollback, but it accumulates the same way.
    const historyRows = frame.historyRows.slice(-maxHistoryRows);
    return {
      kind: 'applied',
      state: {
        panelId: frame.panelId,
        revision: frame.revision,
        upperSeq: frame.upperSeq,
        cols: frame.cols,
        rows: frame.rows,
        screen: frame.screen,
        omittedLines: frame.omittedLines + Math.max(0, frame.historyRows.length - historyRows.length),
        historyRows,
        viewportRows: frame.viewportRows,
        ...(frame.cursor === undefined ? {} : { cursor: frame.cursor }),
        historyGeneration: (current?.historyGeneration ?? 0) + 1,
      },
    };
  }
  if (
    current === null
    || current.panelId !== frame.panelId
    || current.cols !== frame.cols
    || current.rows !== frame.rows
    || current.screen !== frame.screen
    || frame.scrolledRows > current.viewportRows.length
  ) return { kind: 'recovery_required' };

  // The desktop names the rows that entered history when it can. Otherwise
  // they are the top of the canvas this client last held — wrong only when the
  // app pins a header there, which is why the desktop names them.
  const scrolled = frame.scrolledRows > 0 && frame.historyRows.length === frame.scrolledRows
    ? frame.historyRows
    : current.viewportRows.slice(0, frame.scrolledRows);
  const combined = [...current.historyRows, ...scrolled];
  const dropped = Math.max(0, combined.length - maxHistoryRows);
  return {
    kind: 'applied',
    state: {
      panelId: frame.panelId,
      revision: frame.revision,
      upperSeq: frame.upperSeq,
      cols: frame.cols,
      rows: frame.rows,
      screen: frame.screen,
      omittedLines: Math.max(frame.omittedLines, current.omittedLines + dropped),
      historyRows: combined.slice(-maxHistoryRows),
      viewportRows: frame.viewportRows,
      ...(frame.cursor === undefined ? {} : { cursor: frame.cursor }),
      historyGeneration: current.historyGeneration ?? 0,
    },
  };
}

export class TerminalGridStore {
  private readonly panels = new Map<string, NativeTerminalGridState>();

  accept(frame: TerminalGridFrame): TerminalGridApplyResult {
    const result = applyTerminalGridFrame(this.panels.get(frame.panelId) ?? null, frame);
    if (result.kind !== 'recovery_required') this.panels.set(frame.panelId, result.state);
    return result;
  }

  get(panelId: string): NativeTerminalGridState | null {
    return this.panels.get(panelId) ?? null;
  }

  remove(panelId: string): void {
    this.panels.delete(panelId);
  }

  clear(): void {
    this.panels.clear();
  }
}
