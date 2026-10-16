/**
 * xterm canvas cannot consume RN tokens. These literals mirror the mobile
 * palette and desktop TERMINAL_THEMES; keep both dark/light sets synchronized.
 */
import type { TerminalGridColor } from '../../../../src/shared/types';

export const MOBILE_TERMINAL_DEFAULT_MINIMUM_CONTRAST_RATIO = 1;
export const MOBILE_CODEX_MINIMUM_CONTRAST_RATIO = 4.5;

export function isCodexInputBackgroundColor(color: TerminalGridColor | undefined): boolean {
  if (color?.kind !== 'rgb') return false;
  const red = (color.value >> 16) & 0xff;
  const green = (color.value >> 8) & 0xff;
  const blue = color.value & 0xff;
  // Codex has used these neutral light input surfaces across releases. Keep
  // the narrow neutral/near-white rule so actual colored terminal art remains intact.
  return (red === 55 && (green === 56 || green === 57) && (blue === 62 || blue === 63))
    || (red >= 235 && green >= 235 && blue >= 235 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 3);
}

export const MOBILE_TERMINAL_THEMES = {
  dark: {
    background: '#1c1f25', foreground: '#e6e8ec', cursor: '#e6e8ec', selectionBackground: '#33465f',
    black: '#22262e', brightBlack: '#858d99', red: '#e0685c', brightRed: '#e0685c',
    green: '#5cb874', brightGreen: '#5cb874', yellow: '#d6a23e', brightYellow: '#d6a23e',
    blue: '#7fa7d9', brightBlue: '#7fa7d9', magenta: '#c08fd9', brightMagenta: '#c08fd9',
    cyan: '#3ba79e', brightCyan: '#3ba79e', white: '#a2a9b4', brightWhite: '#e6e8ec',
  },
  light: {
    background: '#ffffff', foreground: '#23272e', cursor: '#23272e', selectionBackground: '#c3d8f2',
    black: '#eef0f3', brightBlack: '#626a75', red: '#b94339', brightRed: '#b94339',
    green: '#3d9455', brightGreen: '#3d9455', yellow: '#b07f1e', brightYellow: '#b07f1e',
    blue: '#3b6ea8', brightBlue: '#3b6ea8', magenta: '#8f5bb0', brightMagenta: '#8f5bb0',
    cyan: '#23847c', brightCyan: '#23847c', white: '#545c68', brightWhite: '#23272e',
  },
} as const;

export function resolveMobileTerminalColor(
  color: TerminalGridColor | undefined,
  fallback: string,
  mode: keyof typeof MOBILE_TERMINAL_THEMES,
): string {
  if (color === undefined) return fallback;
  if (color.kind === 'rgb') return `#${color.value.toString(16).padStart(6, '0')}`;
  const palette = MOBILE_TERMINAL_THEMES[mode];
  const base = [
    palette.black, palette.red, palette.green, palette.yellow,
    palette.blue, palette.magenta, palette.cyan, palette.white,
    palette.brightBlack, palette.brightRed, palette.brightGreen, palette.brightYellow,
    palette.brightBlue, palette.brightMagenta, palette.brightCyan, palette.brightWhite,
  ];
  if (color.index < base.length) return base[color.index]!;
  if (color.index >= 16 && color.index <= 231) {
    const offset = color.index - 16;
    const levels = [0, 95, 135, 175, 215, 255];
    return `rgb(${levels[Math.floor(offset / 36)]}, ${levels[Math.floor((offset % 36) / 6)]}, ${levels[offset % 6]})`;
  }
  const level = 8 + ((Math.max(232, Math.min(255, color.index)) - 232) * 10);
  return `rgb(${level}, ${level}, ${level})`;
}
