import type { AgentKind } from '../domain/session';
import type { ConnectTheme } from '../theme/theme';
import type { TerminalGeometry, TerminalSegment } from './terminalSegments';

/** Imperative surface of a byte-stream terminal (the native SwiftTerm / Termux view). */
export interface TerminalStreamHandle {
  cancelReplacement(operationId: string): void;
  replace(
    data: string | readonly TerminalSegment[],
    restore?: TerminalRestoreState,
    renderOperationId?: string,
  ): void;
  write(data: string, geometry?: TerminalGeometry, renderOperationId?: string): void;
  setGeometry(geometry: TerminalGeometry): void;
  reportOutputLoss(lines: number): void;
  reportOutputTrimmed(lines: number): void;
  reportRecoveryStarted(): void;
  reportRecoveryFailed(): void;
  scrollToBottom(): void;
}

export interface TerminalRestoreState {
  trimmedLines?: number;
  lostLines?: number;
  partialLoss?: boolean;
}

export interface TerminalStreamProps {
  agent: AgentKind;
  panelId?: string;
  theme: ConnectTheme;
  onResize(cols: number, rows: number): void;
  onRecoveryNeeded?(): void;
  onPaint?(operationId: string): void;
  /** Stage names are telemetry labels kept from the WebView era; do not rename. */
  onRenderStage?(
    operationId: string,
    stage: 'webview_received' | 'vt_parsed' | 'frame_committed',
  ): void;
}
