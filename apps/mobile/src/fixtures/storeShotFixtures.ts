import type { TerminalGridRow, TerminalGridStyle } from '../../../../src/shared/types';
import type { SessionViewModel } from '../domain/session';
import type { MobileRoomMessage } from '../net/bridgeClient';
import type { NativeTerminalGridState } from '../terminal/terminalGridModel';
import type { StoreShot, StoreShotLocale } from '../storeShot';

/**
 * Demo data for the App Store screenshots. Everything here is invented: a
 * made-up project, sessions, a conversation and a terminal transcript, so no
 * real project content can end up in a store listing (主计划 STORE-SCREENSHOTS-01).
 */

const PROJECT = 'travel-planner';
const OTHER_PROJECT = 'portfolio-site';
const PROJECT_CAPABILITY = 'wcap_storeshot_travel_planner0';
const OTHER_CAPABILITY = 'wcap_storeshot_portfolio_site00';

const CLAUDE_PANEL = 'pty-storeshot-claude';
const CODEX_PANEL = 'pty-storeshot-codex';
const SHELL_PANEL = 'pty-storeshot-shell';
const ROOM_PANEL = 'room-storeshot-date-range';
const OTHER_PANEL = 'pty-storeshot-portfolio';

const COPY: Record<StoreShotLocale, { room: string }> = {
  'zh-Hans': { room: '日期区间改版' },
  'zh-Hant': { room: '日期區間改版' },
  en: { room: 'Date range update' },
};

export function storeShotSession(shot: Pick<StoreShot, 'scene' | 'locale'>): SessionViewModel {
  const copy = COPY[shot.locale];
  const activePanelId = shot.scene === 'room' ? ROOM_PANEL : CLAUDE_PANEL;
  return {
    deviceName: 'Mac · 100.101.7.42',
    connection: 'online',
    ownership: 'mobile_owned',
    ownershipAuthority: 'mobile_owned',
    agent: 'claude',
    // 真实 App 目前没有会话运行态数据（手机端会话状态未做），商店截图不得展示「正在运行 + 停止」（2026-10-04）。
    taskPhase: 'idle',
    lines: [],
    draft: '',
    pendingIntent: null,
    isDemo: false,
    panels: [
      { panelId: CLAUDE_PANEL, kind: 'claude', label: `Claude · ${PROJECT}`, workspaceCapability: PROJECT_CAPABILITY, workspaceLabel: PROJECT },
      { panelId: CODEX_PANEL, kind: 'codex', label: `Codex · ${PROJECT}`, workspaceCapability: PROJECT_CAPABILITY, workspaceLabel: PROJECT },
      // Exactly what the Mac sends, in any language; the phone names it (panelLabel.ts).
      { panelId: SHELL_PANEL, kind: 'shell', label: `终端 · ${PROJECT}`, workspaceCapability: PROJECT_CAPABILITY, workspaceLabel: PROJECT },
      { panelId: ROOM_PANEL, kind: 'collaboration', label: copy.room, workspaceCapability: PROJECT_CAPABILITY, workspaceLabel: PROJECT },
      { panelId: OTHER_PANEL, kind: 'codex', label: `Codex · ${OTHER_PROJECT}`, workspaceCapability: OTHER_CAPABILITY, workspaceLabel: OTHER_PROJECT },
    ],
    workspaces: [
      { workspaceCapability: PROJECT_CAPABILITY, label: PROJECT, activeSurfaceCount: 4 },
      { workspaceCapability: OTHER_CAPABILITY, label: OTHER_PROJECT, activeSurfaceCount: 1 },
    ],
    activePanelId,
    ownershipEpoch: 3,
    panelExited: false,
    canControlInput: true,
    hasActivePanel: true,
  };
}

export const STORE_SHOT_WORKSPACE = PROJECT_CAPABILITY;

/**
 * `web` 场景（iPad 网页镜像 UI 测试，ADR-003 §19）里桌面「正在打开的网页面板」目录。
 * 与真实协议一样只有不透明 capability 与标题，**没有 URL 或路径**。
 */
export function storeShotBrowserPanels(locale: StoreShotLocale): Array<{
  browserCapability: string;
  title: string;
  workspaceCapability: string;
  workspaceLabel: string;
}> {
  const title = locale === 'en' ? 'Local preview' : locale === 'zh-Hant' ? '本地預覽' : '本地预览';
  return [{
    browserCapability: 'bcap_storeshot_local_preview00',
    title,
    workspaceCapability: PROJECT_CAPABILITY,
    workspaceLabel: PROJECT,
  }];
}

/** Six digits, the same length the pairing handshake shows. */
export const STORE_SHOT_SAS = '482915';

const T0 = Date.UTC(2026, 9, 1, 1, 12);

const ROOM: Record<StoreShotLocale, Array<[MobileRoomMessage['from'], string]>> = {
  'zh-Hans': [
    ['user', '行程页的日期选择要支持跨月。Claude 来改，改完交给 Codex 看一遍。'],
    ['claude', '改好了：日期面板可以按月翻页，跨月的区间能连续选中。相关测试 12 项全部通过，交给 Codex。'],
    ['codex', '看完了，整体没问题。有一处边界：结束日期早于开始日期时没有提示。我补了校验和一条测试。'],
    ['claude', '确认这处修复没问题。两处改动都在 feat/date-range 分支上，可以合并了。'],
  ],
  'zh-Hant': [
    ['user', '行程頁的日期選擇要支援跨月。Claude 來改，改完交給 Codex 看一遍。'],
    ['claude', '改好了：日期面板可以按月翻頁，跨月的區間能連續選取。相關測試 12 項全部通過，交給 Codex。'],
    ['codex', '看完了，整體沒問題。有一處邊界：結束日期早於開始日期時沒有提示。我補了檢查和一條測試。'],
    ['claude', '確認這處修正沒問題。兩處改動都在 feat/date-range 分支上，可以合併了。'],
  ],
  en: [
    ['user', 'The trip page date picker should allow ranges across months. Claude, make the change, then hand it to Codex for a review.'],
    ['claude', 'Done. The calendar now pages by month and a range can span months. All 12 related tests pass. Over to Codex.'],
    ['codex', 'Reviewed. Looks good overall, with one edge case: no warning when the end date is before the start date. I added the check and a test.'],
    ['claude', 'Confirmed the fix. Both changes are on feat/date-range and ready to merge.'],
  ],
};

export function storeShotRoomMessages(locale: StoreShotLocale): MobileRoomMessage[] {
  return ROOM[locale].map(([from, text], index) => ({
    id: `storeshot-${index}`,
    from,
    text,
    ts: T0 + index * 94_000,
  }));
}

export const STORE_SHOT_ROOM = ROOM_PANEL;

// ── Terminal: a Claude session on the phone, after takeover (phone-width PTY) ──

const COLS = 46;
const plain: TerminalGridStyle = {
  bold: false, dim: false, italic: false, underline: false,
  inverse: false, invisible: false, strikethrough: false, overline: false,
};
const STYLES = {
  p: plain,
  d: { ...plain, dim: true },
  b: { ...plain, bold: true },
  g: { ...plain, foreground: { kind: 'palette', index: 2 } },
  gb: { ...plain, bold: true, foreground: { kind: 'palette', index: 2 } },
  o: { ...plain, foreground: { kind: 'rgb', value: 0xd77757 } },
  m: { ...plain, foreground: { kind: 'palette', index: 5 } },
} satisfies Record<string, TerminalGridStyle>;
type StyleKey = keyof typeof STYLES;
type Line = Array<[string, StyleKey?]> | string;

function cellWidth(character: string): number {
  const code = character.codePointAt(0) ?? 0;
  return (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe4f)
    || (code >= 0xff00 && code <= 0xff60)
    ? 2
    : 1;
}

function toRow(line: Line): TerminalGridRow {
  const segments = typeof line === 'string' ? [[line, 'p'] as [string, StyleKey]] : line;
  let column = 0;
  const spans = segments.filter(([text]) => text.length > 0).map(([text, style = 'p']) => {
    const width = [...text].reduce((total, character) => total + cellWidth(character), 0);
    const span = { column, width, text, style: STYLES[style] };
    column += width;
    return span;
  });
  if (column > COLS) throw new Error(`store shot terminal line is wider than ${COLS} columns: ${spans.map((span) => span.text).join('')}`);
  return { wrapped: false, spans };
}

const RULE = '─'.repeat(COLS);

function tool(name: string, argument: string): Line {
  return [['⏺ ', 'g'], [name, 'b'], [`(${argument})`]];
}

function result(text: string, style: StyleKey = 'd'): Line {
  return [['  ⎿  ', 'd'], [text, style]];
}

const TERMINAL: Record<StoreShotLocale, { history: Line[]; working: string; prompt: string }> = {
  'zh-Hans': {
    history: [
      [['> ', 'd'], ['行程页的日期选择改成可以跨月选', 'd']],
      '',
      [['⏺ '], ['先看一下现有的日期组件。']],
      '',
      tool('Read', 'src/components/DatePicker.tsx'),
      result('Read 142 lines'),
      '',
      tool('Update', 'src/components/DatePicker.tsx'),
      result('Updated with 18 additions, 6 removals'),
      '',
      tool('Bash', 'npm test -- DatePicker'),
      [['  ⎿  ', 'd'], [' PASS ', 'gb'], [' DatePicker.test.tsx']],
      [['     ✓ ', 'g'], ['跨月选择区间'], [' (12 ms)', 'd']],
      [['     ✓ ', 'g'], ['结束早于开始时提示'], [' (4 ms)', 'd']],
      [['     Tests: '], ['12 passed', 'g'], [', 12 total']],
      '',
      [['⏺ '], ['跨月选择已经支持，12 项测试全部通过。']],
      '  要不要把手机端的日期弹层也改成一样的？',
      '',
      [['> ', 'd'], ['好，一起改了', 'd']],
      '',
      tool('Update', 'src/mobile/DateSheet.tsx'),
      result('Updated with 9 additions, 3 removals'),
      '',
      tool('Bash', 'npm test -- DateSheet'),
      [['  ⎿  ', 'd'], [' PASS ', 'gb'], [' DateSheet.test.tsx']],
      [['     Tests: '], ['7 passed', 'g'], [', 7 total']],
      '',
      [['⏺ '], ['手机端也改好了，两处共用同一套区间逻辑，']],
      '  19 项测试全部通过。',
      '',
    ],
    working: '正在整理改动说明…',
    prompt: '',
  },
  'zh-Hant': {
    history: [
      [['> ', 'd'], ['行程頁的日期選擇改成可以跨月選', 'd']],
      '',
      [['⏺ '], ['先看一下現有的日期元件。']],
      '',
      tool('Read', 'src/components/DatePicker.tsx'),
      result('Read 142 lines'),
      '',
      tool('Update', 'src/components/DatePicker.tsx'),
      result('Updated with 18 additions, 6 removals'),
      '',
      tool('Bash', 'npm test -- DatePicker'),
      [['  ⎿  ', 'd'], [' PASS ', 'gb'], [' DatePicker.test.tsx']],
      [['     ✓ ', 'g'], ['跨月選擇區間'], [' (12 ms)', 'd']],
      [['     ✓ ', 'g'], ['結束早於開始時提示'], [' (4 ms)', 'd']],
      [['     Tests: '], ['12 passed', 'g'], [', 12 total']],
      '',
      [['⏺ '], ['跨月選擇已經支援，12 項測試全部通過。']],
      '  要不要把手機端的日期面板也改成一樣的？',
      '',
      [['> ', 'd'], ['好，一起改了', 'd']],
      '',
      tool('Update', 'src/mobile/DateSheet.tsx'),
      result('Updated with 9 additions, 3 removals'),
      '',
      tool('Bash', 'npm test -- DateSheet'),
      [['  ⎿  ', 'd'], [' PASS ', 'gb'], [' DateSheet.test.tsx']],
      [['     Tests: '], ['7 passed', 'g'], [', 7 total']],
      '',
      [['⏺ '], ['手機端也改好了，兩處共用同一套區間邏輯，']],
      '  19 項測試全部通過。',
      '',
    ],
    working: '正在整理改動說明…',
    prompt: '',
  },
  en: {
    history: [
      [['> ', 'd'], ['Let the trip date picker span months', 'd']],
      '',
      [['⏺ '], ['Let me look at the current date picker.']],
      '',
      tool('Read', 'src/components/DatePicker.tsx'),
      result('Read 142 lines'),
      '',
      tool('Update', 'src/components/DatePicker.tsx'),
      result('Updated with 18 additions, 6 removals'),
      '',
      tool('Bash', 'npm test -- DatePicker'),
      [['  ⎿  ', 'd'], [' PASS ', 'gb'], [' DatePicker.test.tsx']],
      [['     ✓ ', 'g'], ['selects a range across months'], [' (12 ms)', 'd']],
      [['     ✓ ', 'g'], ['warns when end is before start'], [' (4 ms)', 'd']],
      [['     Tests: '], ['12 passed', 'g'], [', 12 total']],
      '',
      [['⏺ '], ['Ranges can now span months and all 12']],
      '  tests pass. Should the mobile date sheet',
      '  work the same way?',
      '',
      [['> ', 'd'], ['Yes, do both', 'd']],
      '',
      tool('Update', 'src/mobile/DateSheet.tsx'),
      result('Updated with 9 additions, 3 removals'),
      '',
      tool('Bash', 'npm test -- DateSheet'),
      [['  ⎿  ', 'd'], [' PASS ', 'gb'], [' DateSheet.test.tsx']],
      [['     Tests: '], ['7 passed', 'g'], [', 7 total']],
      '',
      [['⏺ '], ['The mobile sheet now shares the same range']],
      '  logic. All 19 tests pass.',
      '',
    ],
    working: 'Summarizing the changes…',
    prompt: '',
  },
};

/**
 * The scene shows the phone holding input, and a PTY the phone holds follows
 * the shape its terminal view reports (ADR-003 §11). Pass that shape as `fit`
 * and the frame takes it: the transcript fills the screen from the bottom up,
 * as on a real followed PTY, instead of a 6-row canvas at the top of an iPad
 * with the rest of the conversation out of sight (STORE-SHOTS-SCREENSHOT-MODE-1020).
 */
export function storeShotTerminalFrame(
  locale: StoreShotLocale,
  fit?: { cols: number; rows: number },
): NativeTerminalGridState {
  const copy = TERMINAL[locale];
  const viewport: Line[] = [
    [['✻ ', 'o'], [copy.working, 'o'], [' (esc to interrupt)', 'd']],
    '',
    [[RULE, 'd']],
    [['> '], [copy.prompt]],
    [[RULE, 'd']],
    [['  ⏵⏵ accept edits on', 'm'], [' (shift+tab to cycle)', 'd']],
  ];
  const rows = Math.max(viewport.length, Math.min(200, Math.floor(fit?.rows ?? 0)));
  const transcript = [...copy.history, ...viewport].map(toRow);
  const blank = (): TerminalGridRow => ({ wrapped: false, spans: [] });
  const padded = [...Array.from({ length: Math.max(0, rows - transcript.length) }, blank), ...transcript];
  return {
    panelId: CLAUDE_PANEL,
    revision: 1,
    upperSeq: 1,
    cols: Math.max(COLS, Math.min(500, Math.floor(fit?.cols ?? 0))),
    rows,
    screen: 'normal',
    omittedLines: 0,
    historyRows: padded.slice(0, padded.length - rows),
    viewportRows: padded.slice(padded.length - rows),
    cursor: { row: rows - viewport.length + 3, column: 2, visible: true },
  };
}
