export type TerminalKeyName =
  | 'escape' | 'tab' | 'enter' | 'backspace' | 'delete' | 'insert'
  | 'home' | 'end' | 'page-up' | 'page-down'
  | 'arrow-up' | 'arrow-down' | 'arrow-left' | 'arrow-right' | 'space'
  | `f${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`
  | LowercaseLetter | Digit;
export type LowercaseLetter =
  | 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
  | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';
export type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export interface TerminalKeyModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

function modifierCode(modifiers: TerminalKeyModifiers): number {
  return 1
    + (modifiers.shift === true ? 1 : 0)
    + (modifiers.alt === true ? 2 : 0)
    + (modifiers.ctrl === true ? 4 : 0)
    + (modifiers.meta === true ? 8 : 0);
}

function withAlt(data: string, modifiers: TerminalKeyModifiers): string {
  return modifiers.alt === true ? `\x1b${data}` : data;
}

export function encodeTerminalKey(
  key: TerminalKeyName,
  modifiers: TerminalKeyModifiers = {},
): string {
  if (key.length === 1 && key >= 'a' && key <= 'z') {
    if (modifiers.ctrl === true) return String.fromCharCode(key.charCodeAt(0) - 96);
    return withAlt(modifiers.shift === true ? key.toUpperCase() : key, modifiers);
  }
  if (key.length === 1 && key >= '0' && key <= '9') {
    const shifted = ')!@#$%^&*('[Number(key)];
    return withAlt(modifiers.shift === true ? shifted : key, modifiers);
  }
  if (key === 'space') return modifiers.ctrl === true ? '\x00' : withAlt(' ', modifiers);
  if (key === 'escape') return '\x1b';
  if (key === 'tab') return modifiers.shift === true ? '\x1b[Z' : '\t';
  if (key === 'enter') return withAlt('\r', modifiers);
  if (key === 'backspace') return modifiers.ctrl === true ? '\x08' : withAlt('\x7f', modifiers);

  const arrows: Record<string, string> = {
    'arrow-up': 'A', 'arrow-down': 'B', 'arrow-right': 'C', 'arrow-left': 'D',
  };
  const arrow = arrows[key];
  if (arrow !== undefined) {
    return modifierCode(modifiers) === 1
      ? `\x1b[${arrow}`
      : `\x1b[1;${modifierCode(modifiers)}${arrow}`;
  }

  const csiKeys: Record<string, { code: string; tilde: boolean }> = {
    home: { code: 'H', tilde: false }, end: { code: 'F', tilde: false },
    insert: { code: '2', tilde: true }, delete: { code: '3', tilde: true },
    'page-up': { code: '5', tilde: true }, 'page-down': { code: '6', tilde: true },
  };
  const csi = csiKeys[key];
  if (csi !== undefined) {
    const suffix = `${csi.code}${csi.tilde ? '~' : ''}`;
    return modifierCode(modifiers) === 1
      ? `\x1b[${suffix}`
      : `\x1b[1;${modifierCode(modifiers)}${csi.code}${csi.tilde ? '~' : ''}`;
  }

  const functionKey = /^f(\d+)$/u.exec(key);
  if (functionKey !== null) {
    const number = Number(functionKey[1]);
    const base = number <= 4
      ? `\x1bO${['P', 'Q', 'R', 'S'][number - 1]}`
      : `\x1b[${[15, 17, 18, 19, 20, 21, 23, 24][number - 5]}~`;
    if (modifierCode(modifiers) === 1) return base;
    if (number <= 4) return `\x1b[1;${modifierCode(modifiers)}${['P', 'Q', 'R', 'S'][number - 1]}`;
    return `\x1b[${base.slice(2, -1)};${modifierCode(modifiers)}~`;
  }
  return '';
}

export type TerminalMouseAction = 'press' | 'release' | 'move' | 'wheel-up' | 'wheel-down';
export type TerminalMouseButton = 0 | 1 | 2;

/** SGR mouse protocol; callers must first verify the terminal requested mouse tracking. */
export function encodeTerminalMouse(input: {
  action: TerminalMouseAction;
  button?: TerminalMouseButton;
  column: number;
  row: number;
  modifiers?: TerminalKeyModifiers;
}): string {
  const column = Math.max(1, Math.min(223, Math.trunc(input.column) + 1));
  const row = Math.max(1, Math.min(223, Math.trunc(input.row) + 1));
  const modifiers = input.modifiers ?? {};
  const modifierBits = (modifiers.shift ? 4 : 0) + (modifiers.alt ? 8 : 0) + (modifiers.ctrl ? 16 : 0);
  const button = input.action === 'wheel-up' ? 64 : input.action === 'wheel-down' ? 65 : (input.button ?? 0);
  const code = button + modifierBits + (input.action === 'move' ? 32 : 0);
  const suffix = input.action === 'release' ? 'm' : 'M';
  return `\x1b[<${code};${column};${row}${suffix}`;
}
