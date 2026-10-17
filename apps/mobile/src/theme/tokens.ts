export const CONNECT_PALETTE = {
  dark: {
    bg: '#16181d',
    panel: '#1c1f25',
    panel2: '#22262e',
    line: '#2c313b',
    line2: '#363c48',
    text: '#e6e8ec',
    text2: '#a2a9b4',
    text3: '#858d99',
    claude: '#d9785a',
    codex: '#3ba79e',
    shell: '#8a919c',
    ok: '#5cb874',
    warn: '#d6a23e',
    danger: '#e0685c',
    // 可交互 / 选中 / 开启 / 进行中；与桌面 --accent 同值，不借用身份色
    accent: '#75a7ff',
    // 会话状态灯，与桌面 --lamp-* 同值（MOBILE-SESSION-RUN-STATE-01）
    lampRed: '#ff5f57',
    lampYellow: '#febc2e',
    lampGreen: '#28c840',
    overlay: '#0e1014b8',
  },
  light: {
    bg: '#f4f5f7',
    panel: '#ffffff',
    panel2: '#eef0f3',
    line: '#e2e5ea',
    line2: '#d3d8df',
    text: '#23272e',
    text2: '#545c68',
    text3: '#626a75',
    claude: '#c25f3e',
    codex: '#23847c',
    shell: '#6c7480',
    ok: '#3d9455',
    warn: '#b07f1e',
    danger: '#b94339',
    accent: '#2368c4',
    lampRed: '#ff5f57',
    lampYellow: '#febc2e',
    lampGreen: '#28c840',
    overlay: '#23272e66',
  },
} as const;

export const MOTION = {
  fast01: 70,
  fast02: 110,
  moderate01: 150,
  moderate02: 240,
} as const;

export const SPACE = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x5: 20,
  x6: 24,
} as const;

export const RADIUS = {
  control: 9,
  sheet: 16,
  pill: 999,
} as const;

/** Compact persistent chrome remains legible without consuming the whole viewport at Accessibility XXXL. */
export const MAX_COMPACT_FONT_SCALE = 2;
