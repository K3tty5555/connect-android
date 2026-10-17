import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ConnectTerminalNativeView,
  type ConnectTerminalPalette,
  type ConnectTerminalViewInstance,
} from '../../modules/connect-terminal';
import type { TerminalFontPreference } from '../../../../src/shared/types';
import type { ConnectTheme } from '../theme/theme';
import type { AgentKind } from '../domain/session';
import { MobileAnsiPresentation } from './ansiPresentation';
import { SwiftTermLatestButton } from './SwiftTermLatestButton';
import { MOBILE_TERMINAL_THEMES } from './terminalAppearance';
import { READING_FONT_SIZE } from './terminalGridMetrics';
import type { TerminalGeometry, TerminalSegment } from './terminalSegments';
import type {
  TerminalRestoreState,
  TerminalStreamHandle,
  TerminalStreamProps,
} from './terminalStreamHandle';

const OPERATION_ID_PATTERN = /^(?:req|perf)_[a-zA-Z0-9_-]{8,64}$/u;

type Command =
  | { kind: 'reset' }
  | { kind: 'geometry'; cols: number; rows: number }
  | { kind: 'text'; data: string };

export function swiftTermPalette(mode: ConnectTheme['mode']): ConnectTerminalPalette {
  const theme = MOBILE_TERMINAL_THEMES[mode];
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    ansi: [
      theme.black, theme.red, theme.green, theme.yellow,
      theme.blue, theme.magenta, theme.cyan, theme.white,
      theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
      theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
    ],
  };
}

/**
 * Queues what the terminal must do, in order, merging adjacent text.
 *
 * Output arrives in many small writes; SwiftTerm parses one large feed far
 * more cheaply than many bridge calls. Geometry stays a barrier: text written
 * at one shape must be parsed at that shape.
 */
export class SwiftTermCommandQueue {
  private commands: Command[] = [];

  push(command: Command): void {
    const last = this.commands.at(-1);
    if (command.kind === 'text' && last?.kind === 'text') {
      last.data += command.data;
      return;
    }
    if (command.kind === 'reset') this.commands = [];
    this.commands.push(command);
  }

  clear(): void {
    this.commands = [];
  }

  drain(): Command[] {
    const commands = this.commands;
    this.commands = [];
    return commands;
  }
}

export type TerminalWheelInput = {
  action: 'wheel-up' | 'wheel-down';
  button: 0;
  column: number;
  row: number;
};

export interface SwiftTermTerminalViewProps extends TerminalStreamProps {
  fontFamily: TerminalFontPreference;
  /**
   * Wheel notches for a full-screen app's own history. The same mouse path
   * the native grid uses: ownership, epoch and write scope decide upstream.
   */
  onMouse?(input: TerminalWheelInput): void;
}

/**
 * The PTY byte stream rendered by SwiftTerm, behind the WebView's handle.
 *
 * Everything above it — the swap view, recovery, paint reporting — keeps
 * working unchanged, which is what lets the renderer be a setting.
 */
const SwiftTermTerminalViewComponent = forwardRef<TerminalStreamHandle, SwiftTermTerminalViewProps>(
  function SwiftTermTerminalView({
    agent,
    fontFamily,
    onMouse,
    onPaint,
    onRenderStage,
    onResize,
    theme,
  }, forwardedRef) {
    const nativeRef = useRef<ConnectTerminalViewInstance>(null);
    const queue = useRef(new SwiftTermCommandQueue());
    const presentation = useRef(new MobileAnsiPresentation());
    const flushScheduled = useRef(false);
    /** Commands wait until the native view reports it exists (see onReady). */
    const nativeReady = useRef(false);
    const pendingOperation = useRef<string | null>(null);
    const agentRef = useRef<AgentKind>(agent);
    const paintRef = useRef(onPaint);
    const renderStageRef = useRef(onRenderStage);
    const resizeRef = useRef(onResize);
    const mouseRef = useRef(onMouse);
    /** The PTY's shape, so a wheel lands in the middle of the app's canvas. */
    const geometryRef = useRef<TerminalGeometry>({ cols: 80, rows: 24 });
    mouseRef.current = onMouse;
    agentRef.current = agent;
    paintRef.current = onPaint;
    renderStageRef.current = onRenderStage;
    resizeRef.current = onResize;
    const palette = useMemo(() => swiftTermPalette(theme.mode), [theme.mode]);
    /** Up in the scrollback, as the native view last reported. */
    const [browsing, setBrowsing] = useState(false);

    const flush = (): void => {
      flushScheduled.current = false;
      const view = nativeRef.current;
      if (view === null || !nativeReady.current) return;
      const commands = queue.current.drain();
      const operationId = pendingOperation.current;
      pendingOperation.current = null;
      if (commands.length === 0 && operationId === null) return;
      if (operationId !== null) renderStageRef.current?.(operationId, 'webview_received');
      // One bridge call per flush, run in order on the native side: separate
      // reset/feed calls could land out of order and wipe the replayed screen.
      void view.apply(commands, operationId).catch(() => {
        // The view is gone or failed; the swap's paint deadline recovers it.
      });
      if (operationId !== null) renderStageRef.current?.(operationId, 'vt_parsed');
    };

    const scheduleFlush = (): void => {
      if (flushScheduled.current) return;
      flushScheduled.current = true;
      queueMicrotask(flush);
    };

    const pushSegment = (data: string, geometry?: TerminalGeometry): void => {
      if (geometry !== undefined) {
        geometryRef.current = { ...geometry };
        queue.current.push({ kind: 'geometry', ...geometry });
      }
      const presented = presentation.current.write(data, agentRef.current === 'codex');
      if (presented.length > 0) queue.current.push({ kind: 'text', data: presented });
    };

    const claimOperation = (operationId: string | undefined): void => {
      if (operationId !== undefined && OPERATION_ID_PATTERN.test(operationId)) {
        pendingOperation.current ??= operationId;
      }
    };

    useImperativeHandle(forwardedRef, () => ({
      cancelReplacement(operationId: string): void {
        if (pendingOperation.current === operationId) pendingOperation.current = null;
      },
      replace(
        data: string | readonly TerminalSegment[],
        _restore: TerminalRestoreState = {},
        renderOperationId?: string,
      ): void {
        presentation.current.reset();
        queue.current.push({ kind: 'reset' });
        pendingOperation.current = null;
        claimOperation(renderOperationId);
        for (const segment of typeof data === 'string' ? [{ data }] : data) {
          pushSegment(segment.data, segment.geometry);
        }
        scheduleFlush();
      },
      write(data: string, geometry?: TerminalGeometry, renderOperationId?: string): void {
        if (data.length === 0) return;
        claimOperation(renderOperationId);
        pushSegment(data, geometry);
        scheduleFlush();
      },
      setGeometry(geometry: TerminalGeometry): void {
        geometryRef.current = { ...geometry };
        queue.current.push({ kind: 'geometry', ...geometry });
        scheduleFlush();
      },
      // Loss and trimming notices belong to the WebView's own chrome; the
      // SwiftTerm view shows the terminal alone.
      reportOutputLoss(): void {},
      reportOutputTrimmed(): void {},
      reportRecoveryStarted(): void {
        queue.current.clear();
      },
      reportRecoveryFailed(): void {},
      scrollToBottom(): void {
        void nativeRef.current?.scrollToBottom();
      },
    }), []);

    useEffect(() => {
      presentation.current.reset();
    }, [agent]);

    // Anything queued before the native view mounted goes out once it has.
    useEffect(() => {
      scheduleFlush();
    }, []);

    const NativeView = ConnectTerminalNativeView;
    if (NativeView === null) return <View style={[styles.container, { backgroundColor: palette.background }]} />;
    return (
      <View style={styles.container}>
      <NativeView
        fontFamily={fontFamily}
        onBrowsing={(event) => setBrowsing(event.nativeEvent.browsing)}
        onFit={(event) => resizeRef.current(event.nativeEvent.cols, event.nativeEvent.rows)}
        onReady={() => {
          nativeReady.current = true;
          scheduleFlush();
        }}
        onPainted={(event) => {
          const { operationId } = event.nativeEvent;
          renderStageRef.current?.(operationId, 'frame_committed');
          paintRef.current?.(operationId);
        }}
        onWheel={(event) => {
          const { cols, rows } = geometryRef.current;
          mouseRef.current?.({
            action: event.nativeEvent.direction === 'up' ? 'wheel-up' : 'wheel-down',
            button: 0,
            column: Math.floor(cols / 2),
            row: Math.floor(rows / 2),
          });
        }}
        palette={palette}
        preferredFontSize={READING_FONT_SIZE}
        ref={nativeRef}
        style={[styles.container, { backgroundColor: palette.background }]}
        testID="terminal-swiftterm"
      />
      {browsing ? (
        <SwiftTermLatestButton
          onPress={() => {
            setBrowsing(false);
            void nativeRef.current?.scrollToBottom();
          }}
          theme={theme}
        />
      ) : null}
      </View>
    );
  },
);

export const SwiftTermTerminalView = memo(SwiftTermTerminalViewComponent);

/** Whether this binary carries the native SwiftTerm view at all. */
export const swiftTermAvailable = ConnectTerminalNativeView !== null;

const styles = StyleSheet.create({
  container: { flex: 1 },
});
