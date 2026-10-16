import {
  forwardRef,
  memo,
  type ComponentProps,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowDown, X } from 'lucide-react-native';
import {
  WebView,
  type WebViewMessageEvent,
} from 'react-native-webview';
import type { ConnectTheme } from '../theme/theme';
import type { AgentKind } from '../domain/session';
import { useScreenReaderEnabled } from '../theme/screenReader';
import { MobileAnsiPresentation } from './ansiPresentation';
import { MotionPressable } from '../components/MotionPressable';
import { RADIUS, SPACE } from '../theme/tokens';
import {
  MOBILE_CODEX_MINIMUM_CONTRAST_RATIO,
  MOBILE_TERMINAL_DEFAULT_MINIMUM_CONTRAST_RATIO,
  MOBILE_TERMINAL_THEMES,
} from './terminalAppearance';
import {
  BoundedTerminalSegments,
  type TerminalGeometry,
  type TerminalSegment,
} from './terminalSegments';
import { t } from '../i18n';

// Metro resolves bundled HTML to an asset id at runtime; WebView's public source
// type omits that documented React Native asset form.
const TERMINAL_SOURCE = require('../../assets/terminal/index.html') as unknown as ComponentProps<typeof WebView>['source'];
const MAX_PENDING_CHARS = 2 * 1024 * 1024;
const WRITE_BATCH_CHARS = 32 * 1024;

export interface TerminalWebViewHandle {
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

export interface TerminalWebViewProps {
  agent: AgentKind;
  panelId?: string;
  theme: ConnectTheme;
  onResize(cols: number, rows: number): void;
  onRecoveryNeeded?(): void;
  onPaint?(operationId: string): void;
  onRenderStage?(
    operationId: string,
    stage: 'webview_received' | 'vt_parsed' | 'frame_committed',
  ): void;
}

type OutputNotice =
  | { kind: 'trimmed' | 'lost'; lines: number; version: number; dismissible: true }
  | { kind: 'partialLoss'; version: number; dismissible: true }
  | { kind: 'recovering'; dismissible: false };

type HostMessage =
  | { kind: 'ready' }
  | { kind: 'drained'; batchId: number }
  | { kind: 'recoveryNeeded' }
  | { kind: 'resize'; cols: number; rows: number }
  | { kind: 'outputTrimmed'; lines: number }
  | { kind: 'scrollState'; atLatest: boolean }
  | {
      kind: 'renderStage';
      operationId: string;
      stage: 'webview_received' | 'vt_parsed' | 'frame_committed';
    }
  | { kind: 'painted'; operationId: string }
  | { kind: 'error'; code: string };

const OPERATION_ID_PATTERN = /^(?:req|perf)_[a-zA-Z0-9_-]{8,64}$/u;

function parseHostMessage(raw: string): HostMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'ready' && Object.keys(record).length === 1) return { kind: 'ready' };
  if (
    record.kind === 'drained'
    && Object.keys(record).length === 2
    && Number.isSafeInteger(record.batchId)
    && (record.batchId as number) >= 1
  ) return { kind: 'drained', batchId: record.batchId as number };
  if (record.kind === 'recoveryNeeded' && Object.keys(record).length === 1) {
    return { kind: 'recoveryNeeded' };
  }
  if (
    record.kind === 'scrollState'
    && Object.keys(record).length === 2
    && typeof record.atLatest === 'boolean'
  ) return { kind: 'scrollState', atLatest: record.atLatest };
  if (
    record.kind === 'renderStage'
    && Object.keys(record).length === 3
    && typeof record.operationId === 'string'
    && OPERATION_ID_PATTERN.test(record.operationId)
    && (
      record.stage === 'webview_received'
      || record.stage === 'vt_parsed'
      || record.stage === 'frame_committed'
    )
  ) return {
    kind: 'renderStage',
    operationId: record.operationId,
    stage: record.stage,
  };
  if (
    record.kind === 'painted'
    && Object.keys(record).length === 2
    && typeof record.operationId === 'string'
    && OPERATION_ID_PATTERN.test(record.operationId)
  ) return { kind: 'painted', operationId: record.operationId };
  if (
    record.kind === 'outputTrimmed'
    && Object.keys(record).length === 2
    && Number.isSafeInteger(record.lines)
    && (record.lines as number) >= 1
  ) return { kind: 'outputTrimmed', lines: record.lines as number };
  if (
    record.kind === 'resize'
    && Object.keys(record).length === 3
    && Number.isInteger(record.cols)
    && Number.isInteger(record.rows)
    && (record.cols as number) >= 2
    && (record.cols as number) <= 500
    && (record.rows as number) >= 1
    && (record.rows as number) <= 200
  ) return { kind: 'resize', cols: record.cols as number, rows: record.rows as number };
  if (
    record.kind === 'error'
    && Object.keys(record).length === 2
    && typeof record.code === 'string'
    && record.code.length <= 64
  ) return { kind: 'error', code: record.code };
  return null;
}

const TerminalWebViewComponent = forwardRef<TerminalWebViewHandle, TerminalWebViewProps>(
  function TerminalWebView({
    agent,
    panelId = 'unknown-panel',
    onPaint,
    onRecoveryNeeded,
    onRenderStage,
    onResize,
    theme,
  }, forwardedRef) {
    const webview = useRef<WebView>(null);
    const output = useRef(new BoundedTerminalSegments(MAX_PENDING_CHARS));
    const presentation = useRef(new MobileAnsiPresentation());
    const flushScheduled = useRef(false);
    const replacePending = useRef(false);
    const inFlightBatchId = useRef<number | null>(null);
    const nextBatchId = useRef(1);
    const ready = useRef(false);
    const agentRef = useRef(agent);
    const themeRef = useRef(theme);
    const geometryRef = useRef<TerminalGeometry | null>(null);
    const recovering = useRef(false);
    const recoveryCallback = useRef(onRecoveryNeeded);
    const paintCallback = useRef(onPaint);
    const renderStageCallback = useRef(onRenderStage);
    const pendingRenderOperationId = useRef<string | null>(null);
    const [hostReady, setHostReady] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const [outputNotice, setOutputNotice] = useState<OutputNotice | null>(null);
    const [atLatest, setAtLatest] = useState(true);
    const dismissedNotices = useRef(new Map<string, number>());
    const screenReaderEnabled = useScreenReaderEnabled();
    agentRef.current = agent;
    themeRef.current = theme;
    recoveryCallback.current = onRecoveryNeeded;
    paintCallback.current = onPaint;
    renderStageCallback.current = onRenderStage;

    const noticeKey = (kind: 'trimmed' | 'lost' | 'partialLoss'): string => `${panelId}:${kind}`;
    const showNotice = (
      kind: 'trimmed' | 'lost' | 'partialLoss',
      version: number,
      lines?: number,
    ): void => {
      if ((dismissedNotices.current.get(noticeKey(kind)) ?? -1) >= version) return;
      setOutputNotice(kind === 'partialLoss'
        ? { kind, version, dismissible: true }
        : { kind, lines: lines ?? version, version, dismissible: true });
    };

    const postConfig = (): void => {
      const currentTheme = themeRef.current;
      webview.current?.postMessage(JSON.stringify({
        kind: 'config',
        inputEnabled: false,
        minimumContrastRatio: agentRef.current === 'codex'
          ? MOBILE_CODEX_MINIMUM_CONTRAST_RATIO
          : MOBILE_TERMINAL_DEFAULT_MINIMUM_CONTRAST_RATIO,
        watchMode: true,
        rendererMode: screenReaderEnabled ? 'dom' : 'canvas',
        screenReaderEnabled,
        background: currentTheme.colors.panel,
        colorScheme: currentTheme.mode,
        theme: MOBILE_TERMINAL_THEMES[currentTheme.mode],
      }));
      if (geometryRef.current !== null) {
        webview.current?.postMessage(JSON.stringify({
          kind: 'geometry',
          ...geometryRef.current,
        }));
      }
    };

    const present = (segments: readonly TerminalSegment[]): TerminalSegment[] => (
      segments.map((segment) => ({
        data: presentation.current.write(
          segment.data,
          agentRef.current === 'codex',
        ),
        ...(segment.geometry === undefined ? {} : { geometry: segment.geometry }),
      })).filter((segment) => segment.data.length > 0)
    );

    const flush = (): void => {
      flushScheduled.current = false;
      if (!ready.current || loadFailed || inFlightBatchId.current !== null) return;
      const postOutputBatch = (message: Record<string, unknown>): void => {
        const batchId = nextBatchId.current;
        nextBatchId.current = batchId === Number.MAX_SAFE_INTEGER ? 1 : batchId + 1;
        inFlightBatchId.current = batchId;
        webview.current?.postMessage(JSON.stringify({ ...message, batchId }));
      };
      if (replacePending.current) {
        const raw = output.current.drain(MAX_PENDING_CHARS);
        replacePending.current = false;
        presentation.current.reset();
        const renderOperationId = pendingRenderOperationId.current;
        pendingRenderOperationId.current = null;
        postOutputBatch({
          kind: 'replace',
          segments: present(raw),
          ...(renderOperationId === null ? {} : { renderOperationId }),
        });
        return;
      }
      const raw = output.current.drain(WRITE_BATCH_CHARS);
      if (raw.length > 0) {
        const segments = present(raw);
        const renderOperationId = segments.length > 0 ? pendingRenderOperationId.current : null;
        if (segments.length > 0) pendingRenderOperationId.current = null;
        postOutputBatch({
          kind: 'write',
          segments,
          ...(renderOperationId === null ? {} : { renderOperationId }),
        });
      }
    };

    const scheduleFlush = (): void => {
      if (!ready.current || flushScheduled.current) return;
      flushScheduled.current = true;
      queueMicrotask(() => {
        flushScheduled.current = false;
        flush();
      });
    };

    const enqueue = (data: string, geometry?: TerminalGeometry): void => {
      const dropped = output.current.enqueue(data, geometry);
      if (dropped.chars > 0) {
        output.current.clear();
        recovering.current = true;
        setOutputNotice({ kind: 'recovering', dismissible: false });
        recoveryCallback.current?.();
        return;
      }
      scheduleFlush();
    };

    useImperativeHandle(forwardedRef, () => ({
      cancelReplacement(operationId: string): void {
        if (pendingRenderOperationId.current === operationId) {
          pendingRenderOperationId.current = null;
        }
      },
      replace(
        data: string | readonly TerminalSegment[],
        restore = {},
        renderOperationId?: string,
      ): void {
        if (loadFailed) return;
        output.current.replace(typeof data === 'string' ? [{ data }] : data);
        recovering.current = false;
        replacePending.current = true;
        pendingRenderOperationId.current = renderOperationId !== undefined
          && OPERATION_ID_PATTERN.test(renderOperationId)
          ? renderOperationId
          : null;
        if (restore.lostLines && restore.lostLines > 0) {
          showNotice('lost', restore.lostLines, restore.lostLines);
        } else if (restore.partialLoss) {
          showNotice('partialLoss', 1);
        } else if (restore.trimmedLines && restore.trimmedLines > 0) {
          showNotice('trimmed', restore.trimmedLines, restore.trimmedLines);
        } else {
          setOutputNotice(null);
        }
        if (ready.current) flush();
      },
      write(data: string, geometry?: TerminalGeometry, renderOperationId?: string): void {
        if (loadFailed || recovering.current || data.length === 0) return;
        if (renderOperationId !== undefined && OPERATION_ID_PATTERN.test(renderOperationId)) {
          pendingRenderOperationId.current ??= renderOperationId;
        }
        enqueue(data, geometry);
      },
      setGeometry(geometry: TerminalGeometry): void {
        geometryRef.current = { ...geometry };
        if (!ready.current || loadFailed) return;
        webview.current?.postMessage(JSON.stringify({ kind: 'geometry', ...geometry }));
      },
      reportOutputLoss(lines: number): void {
        if (lines > 0) showNotice('lost', lines, lines);
        else showNotice('partialLoss', 1);
      },
      reportOutputTrimmed(lines: number): void {
        if (lines > 0) showNotice('trimmed', lines, lines);
      },
      reportRecoveryStarted(): void {
        output.current.clear();
        recovering.current = true;
        setOutputNotice({ kind: 'recovering', dismissible: false });
      },
      reportRecoveryFailed(): void {
        if (recovering.current) setOutputNotice(null);
      },
      scrollToBottom(): void {
        if (!ready.current || loadFailed) return;
        webview.current?.postMessage(JSON.stringify({ kind: 'scrollToBottom' }));
      },
    }), [loadFailed, panelId]);

    useEffect(() => {
      if (ready.current) postConfig();
    }, [agent, screenReaderEnabled, theme.mode]);

    useEffect(() => {
      presentation.current.reset();
    }, [agent]);

    useEffect(() => {
      setOutputNotice(null);
    }, [panelId]);

    useEffect(() => {
      if (hostReady || loadFailed) return;
      const timer = setTimeout(() => setLoadFailed(true), 8_000);
      return () => clearTimeout(timer);
    }, [hostReady, loadFailed]);

    useEffect(() => () => {
      ready.current = false;
      flushScheduled.current = false;
    }, []);

    const fail = (): void => {
      ready.current = false;
      inFlightBatchId.current = null;
      setLoadFailed(true);
    };

    const receive = (event: WebViewMessageEvent): void => {
      const message = parseHostMessage(event.nativeEvent.data);
      if (!message) return;
      if (message.kind === 'ready') {
        ready.current = true;
        inFlightBatchId.current = null;
        setHostReady(true);
        postConfig();
        flush();
      } else if (message.kind === 'drained') {
        if (message.batchId !== inFlightBatchId.current) return;
        inFlightBatchId.current = null;
        flush();
      } else if (message.kind === 'resize') {
        onResize(message.cols, message.rows);
      } else if (message.kind === 'outputTrimmed') {
        showNotice('trimmed', message.lines, message.lines);
      } else if (message.kind === 'scrollState') {
        setAtLatest(message.atLatest);
      } else if (message.kind === 'renderStage') {
        renderStageCallback.current?.(message.operationId, message.stage);
      } else if (message.kind === 'painted') {
        paintCallback.current?.(message.operationId);
      } else if (message.kind === 'recoveryNeeded') {
        inFlightBatchId.current = null;
        output.current.clear();
        recovering.current = true;
        setOutputNotice({ kind: 'recovering', dismissible: false });
        recoveryCallback.current?.();
      } else {
        setLoadFailed(true);
      }
    };

    if (loadFailed) {
      return (
        <View accessibilityRole="alert" style={[styles.error, { backgroundColor: theme.colors.panel }]}>
          <Text style={{ color: theme.colors.danger }}>{t('终端视图加载失败')}</Text>
        </View>
      );
    }

    return (
      <View
        onLayout={() => {
          // KeyboardAvoidingView changes this viewport's height. Re-anchor only
          // when the user was already at the latest row; history browsing stays put.
          if (atLatest && ready.current) {
            webview.current?.postMessage(JSON.stringify({ kind: 'scrollToBottom' }));
          }
        }}
        style={[styles.container, { backgroundColor: theme.colors.panel }]}
      >
        {outputNotice ? (
          <View
            accessibilityRole="alert"
            style={[
              styles.outputNotice,
              {
                backgroundColor: theme.colors.panel2,
                borderBottomColor: theme.colors.line,
              },
            ]}
          >
            <Text numberOfLines={1} style={[styles.outputNoticeText, { color: theme.colors.warn }]}>
              {outputNotice.kind === 'trimmed'
                ? t('已截断较早输出 · {lines} 行', { lines: outputNotice.lines })
                : outputNotice.kind === 'lost'
                  ? t('已丢失 {lines} 行输出', { lines: outputNotice.lines })
                  : outputNotice.kind === 'partialLoss'
                    ? t('部分输出已丢失')
                    : t('正在恢复终端画面…')}
            </Text>
            {outputNotice.dismissible ? (
              <MotionPressable
                accessibilityLabel={t('关闭输出提示')}
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  dismissedNotices.current.set(
                    noticeKey(outputNotice.kind),
                    outputNotice.version,
                  );
                  setOutputNotice(null);
                }}
                style={styles.outputNoticeClose}
              >
                <X color={theme.colors.text2} size={16} />
              </MotionPressable>
            ) : null}
          </View>
        ) : null}
        <WebView
          allowFileAccess
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          automaticallyAdjustContentInsets={false}
          bounces={false}
          cacheEnabled={false}
          containerStyle={{ backgroundColor: theme.colors.panel }}
          contentInsetAdjustmentBehavior="never"
          domStorageEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          mixedContentMode="never"
          onContentProcessDidTerminate={fail}
          onError={fail}
          onMessage={receive}
          onShouldStartLoadWithRequest={(request) => (
            request.url === 'about:blank' || request.url.startsWith('file:')
          )}
          originWhitelist={['file://*']}
          overScrollMode="never"
          ref={webview}
          scrollEnabled
          setSupportMultipleWindows={false}
          source={TERMINAL_SOURCE}
          style={[styles.webview, { backgroundColor: theme.colors.panel }]}
          testID="terminal-webview"
          textInteractionEnabled
        />
        {!hostReady ? (
          <View pointerEvents="none" style={[styles.loading, { backgroundColor: theme.colors.panel }]}>
            <Text style={{ color: theme.colors.text3 }}>{t('正在加载终端')}</Text>
          </View>
        ) : null}
        {hostReady && !atLatest ? (
          <MotionPressable
            accessibilityLabel={t('回到最新')}
            accessibilityRole="button"
            onPress={() => {
              webview.current?.postMessage(JSON.stringify({ kind: 'scrollToBottom' }));
            }}
            style={[
              styles.latestButton,
              {
                backgroundColor: theme.colors.panel2,
                borderColor: theme.colors.line2,
              },
            ]}
          >
            <ArrowDown color={theme.colors.text} size={18} />
          </MotionPressable>
        ) : null}
      </View>
    );
  },
);

export const TerminalWebView = memo(TerminalWebViewComponent);

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  webview: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outputNotice: {
    minHeight: 28,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    flexDirection: 'row',
  },
  outputNoticeText: { flex: 1 },
  outputNoticeClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  latestButton: {
    position: 'absolute',
    right: SPACE.x3,
    bottom: SPACE.x3,
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
