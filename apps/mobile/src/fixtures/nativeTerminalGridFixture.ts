import type { TerminalGridRow } from '../../../../src/shared/types';
import type { NativeTerminalGridState } from '../terminal/terminalGridModel';

const plain = {
  bold: false, dim: false, italic: false, underline: false,
  inverse: false, invisible: false, strikethrough: false, overline: false,
};
const accent = { ...plain, foreground: { kind: 'palette' as const, index: 6 } };

function row(text: string, wrapped = false, color = false): TerminalGridRow {
  return {
    wrapped,
    spans: text.length === 0 ? [] : [{
      column: 0,
      width: [...text].reduce((total, character) => (
        total + (/[^\u0000-\u00ff]/u.test(character) ? 2 : 1)
      ), 0),
      text,
      style: color ? accent : plain,
    }],
  };
}

export const NATIVE_TERMINAL_GRID_FIXTURE: NativeTerminalGridState = {
  panelId: 'pty-demo-native-grid',
  revision: 1,
  upperSeq: 1,
  cols: 100,
  rows: 8,
  screen: 'normal',
  omittedLines: 0,
  historyRows: [
    row('111 -5. `INPUT-TXN-01`, `RENDER-ANCHOR-01`, `RECOVE'),
    row('RY-OWNER-01` 已完成实现与自动化；不得继续扩张。', true),
    row('路径：docs/design/connect-mobile-terminal-wrap-evidence/report.json', false, true),
  ],
  viewportRows: [
    row('原生终端阅读模式保留 RECOVERY-OWNER-01 与 git diff --check。'),
    row('中文长输出在手机宽度下由原生 Text 排版，不修改 Mac PTY geometry。'),
    row(''), row(''), row(''), row(''), row(''), row(''),
  ],
  cursor: { row: 1, column: 70, visible: true },
};

/**
 * Long-history variant for the scroll-anchor UI test. The reading list must be
 * tall enough that cells are measured lazily, which is what used to yank the
 * anchor back to the newest row mid-drag.
 */
export const NATIVE_TERMINAL_GRID_HISTORY_FIXTURE: NativeTerminalGridState = {
  ...NATIVE_TERMINAL_GRID_FIXTURE,
  historyRows: [
    row('SCROLL-ANCHOR-TOP 最早一行历史输出'),
    ...Array.from({ length: 160 }, (_unused, index) => row(
      `history-${String(index).padStart(3, '0')} 中文与 ASCII 混排的历史输出行`,
    )),
    row('SCROLL-ANCHOR-TAIL 最后一行历史输出'),
  ],
};

/**
 * MOBILE-CHAT-NOT-AT-LATEST-1012 回归夹具: the bridge's real arrival order for a reopened session —
 * a viewport-only first frame, then the same screen with its long history.
 * Name: seq-<normal|alternate>-<rows>-<cols>.
 */
export function swiftTermSequenceFixture(name: string): NativeTerminalGridState[] | null {
  const match = /^seq-(normal|alternate)-(\d+)-(\d+)$/u.exec(name);
  if (!match) return null;
  const screen = match[1] as 'normal' | 'alternate';
  const rows = Number(match[2]);
  const cols = Number(match[3]);
  const viewport = Array.from({ length: rows }, (_unused, index) => (
    index === rows - 3 ? row('LATEST-ROW 最新一行输出 newest output')
      : index === rows - 1 ? row('> ')
        : index < rows - 4 ? row(`viewport-${String(index).padStart(3, '0')} 当前屏内容`) : row('')
  ));
  const history = Array.from({ length: 240 }, (_unused, index) => row(
    `history-${String(index).padStart(3, '0')} 中文与 ASCII 混排的历史输出行`,
  ));
  const base = {
    panelId: `pty-repro-${screen}`,
    upperSeq: 1,
    cols,
    rows,
    screen,
    omittedLines: 0,
    viewportRows: viewport,
    cursor: { row: rows - 1, column: 2, visible: true },
  };
  return [
    { ...base, revision: 1, historyRows: [] },
    { ...base, revision: 2, upperSeq: 2, historyRows: history },
  ];
}

/**
 * IPAD-SIDEBAR-SCROLL-TOP-1025 回归夹具: the reader scrolls up into a long
 * history, then the desktop rebuilds the panel whole. Name:
 * rewrap-normal-<rows>-<cols>-<newCols>. A new width re-wraps history shorter
 * (the iPad sidebar toggled while the phone holds input) and must open on the
 * newest row; the same width replaces history at the same shape and must keep
 * the reader's place. The second frame waits long enough for the UI test to
 * scroll up first (see nativeGridSequenceStepMs).
 */
function rewrapFixture(name: string): NativeTerminalGridState[] | null {
  const match = /^rewrap-normal-(\d+)-(\d+)-(\d+)$/u.exec(name);
  if (!match) return null;
  const rows = Number(match[1]);
  const cols = Number(match[2]);
  const newCols = Number(match[3]);
  const viewport = Array.from({ length: rows }, (_unused, index) => (
    index === rows - 3 ? row('LATEST-ROW 最新一行输出 newest output')
      : index === rows - 1 ? row('> ') : row('')
  ));
  const history = (label: string, length: number): TerminalGridRow[] => Array.from(
    { length },
    (_unused, index) => row(`${label}-${String(index).padStart(3, '0')} 中文与 ASCII 混排的历史输出行`),
  );
  const base = {
    panelId: 'pty-repro-rewrap',
    upperSeq: 1,
    cols,
    rows,
    screen: 'normal' as const,
    omittedLines: 0,
    viewportRows: viewport,
    cursor: { row: rows - 1, column: 2, visible: true },
  };
  return [
    { ...base, revision: 1, historyRows: history('history', 240) },
    newCols === cols
      // Same shape, history replaced: a whole rebuild that keeps the place.
      // Twenty rows longer, so the test can see it arrive in the buffer size.
      ? { ...base, revision: 2, upperSeq: 2, historyRows: history('rebuilt', 260) }
      // New width: history re-wrapped into far fewer rows.
      : { ...base, revision: 2, upperSeq: 2, cols: newCols, historyRows: history('rewrapped', 20) },
  ];
}

/** Every native-grid sequence fixture by name: seq-* or rewrap-*. */
export function nativeGridSequenceFixture(name: string): NativeTerminalGridState[] | null {
  return swiftTermSequenceFixture(name) ?? rewrapFixture(name);
}

/** When the second frame of a sequence fixture arrives. */
export function nativeGridSequenceStepMs(name: string): number {
  return name.startsWith('rewrap-') ? 12_000 : 1500;
}
