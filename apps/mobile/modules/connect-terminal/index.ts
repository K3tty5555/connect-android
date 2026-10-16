import type { Component, ComponentType, Ref } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import { Platform } from 'react-native';
import { requireNativeView, requireOptionalNativeModule } from 'expo';

export interface ConnectTerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  /** The 16 ANSI colours, black through bright white. */
  ansi: string[];
}

export interface ConnectTerminalViewProps extends ViewProps {
  fontFamily: 'menlo' | 'jetbrains-mono';
  preferredFontSize: number;
  palette: ConnectTerminalPalette;
  /** A full-screen app on the grid path: wheel only past the ends of local scrollback. */
  wheelAtEdges?: boolean;
  /** 演示/UI 测试构建：经无障碍值暴露几何/最新行可见性（产品构建为 false） */
  probe?: boolean;
  onFit?(event: NativeSyntheticEvent<{ cols: number; rows: number }>): void;
  onPainted?(event: NativeSyntheticEvent<{ operationId: string }>): void;
  /** A vertical drag over a full-screen app, one event per wheel notch. */
  onWheel?(event: NativeSyntheticEvent<{ direction: 'up' | 'down' }>): void;
  /** The native view exists and can take commands; nothing sent before this arrives. */
  onReady?(event: NativeSyntheticEvent<Record<string, never>>): void;
  /** The reader left the bottom of the scrollback, or came back to it. */
  onBrowsing?(event: NativeSyntheticEvent<{ browsing: boolean }>): void;
  ref?: Ref<ConnectTerminalViewInstance>;
}

/** Commands the native view exposes on its ref. */
export type ConnectTerminalCommand =
  /** keepScroll: a rebuild of the panel being read keeps the reader's place. */
  | { kind: 'reset'; keepScroll?: boolean }
  | { kind: 'geometry'; cols: number; rows: number }
  | { kind: 'text'; data: string };

export interface ConnectTerminalViewMethods {
  /** One flush, executed in order natively; reports the paint when given an operation. */
  apply(commands: ConnectTerminalCommand[], operationId: string | null): Promise<void>;
  reset(): Promise<void>;
  setGeometry(cols: number, rows: number): Promise<void>;
  feed(text: string): Promise<void>;
  markPainted(operationId: string): Promise<void>;
  scrollToBottom(): Promise<void>;
}

export type ConnectTerminalViewInstance = Component<ConnectTerminalViewProps> & ConnectTerminalViewMethods;

/**
 * Seals a file with iOS complete data protection; on Android it validates the
 * path in app-private storage (sandbox + file-based encryption stand in for
 * per-file protection — see the Kotlin module). Null where this binary does
 * not carry the function (an older install, tests).
 */
export const protectFileComplete: ((path: string) => boolean) | null = (() => {
  const module = requireOptionalNativeModule<{ protectFileComplete?(path: string): boolean }>('ConnectTerminal');
  return typeof module?.protectFileComplete === 'function'
    ? (path: string) => module.protectFileComplete!(path)
    : null;
})();

/**
 * The native terminal view — SwiftTerm on iOS, the Termux-backed view on
 * Android (2026-10-15). Null where this binary does not carry it (an older
 * install, tests). Callers fall back to the WebView renderer.
 */
export const ConnectTerminalNativeView: ComponentType<ConnectTerminalViewProps> | null = (() => {
  // Android 的 requireNativeView 对未注册的视图不抛错，会带回一个渲染时才崩的组件
  // （真机闪退，2026-10-15）；所以平台先验、模块存在再取。
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  if (requireOptionalNativeModule('ConnectTerminal') === null) return null;
  try {
    return requireNativeView<ConnectTerminalViewProps>('ConnectTerminal');
  } catch {
    return null;
  }
})();
