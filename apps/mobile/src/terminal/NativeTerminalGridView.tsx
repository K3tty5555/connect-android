import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeTouchEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ArrowDown } from 'lucide-react-native';
import type {
  TerminalFontPreference,
  TerminalGridColor,
  TerminalGridRow,
  TerminalGridSpan,
  TerminalGridStyle,
} from '../../../../src/shared/types';
import type { ConnectTheme } from '../theme/theme';
import {
  MOBILE_TERMINAL_THEMES,
  isCodexInputBackgroundColor,
  resolveMobileTerminalColor,
} from './terminalAppearance';
import type { NativeTerminalGridState } from './terminalGridModel';
import {
  INITIAL_TERMINAL_FOLLOW_STATE,
  terminalFollowAllowsAutoScroll,
  terminalFollowNext,
  terminalFollowShowsLatestControl,
  terminalScrollAtLatest,
  type TerminalFollowEvent,
} from './terminalFollowMode';
import { useReducedMotion } from '../theme/reducedMotion';
import { MotionPressable } from '../components/MotionPressable';
import { RADIUS, SPACE } from '../theme/tokens';
import {
  READING_CELL_WIDTH,
  READING_FONT_SIZE,
  READING_LINE_HEIGHT,
  READING_PADDING_BOTTOM,
  READING_PADDING_TOP,
  READING_PADDING_X,
  terminalGridMetrics,
  terminalGridViewport,
  terminalReadingViewport,
} from './terminalGridMetrics';
import {
  wrapReadingRuns,
  type MeasuredReadingRun,
  type ReadingRun,
} from './readingWrap';
import { t } from '../i18n';
import { forceTextPresentation } from './textPresentation';

const LONG_PRESS_SELECTION_MS = 350;
/** Overscroll past either end before the app is asked to wheel that way. */
const WHEEL_REQUEST_OVERSCROLL_PX = 24;
/** One notch at a time: the app repaints and the next frame decides the rest. */
const WHEEL_REQUEST_INTERVAL_MS = 120;

type PresentationMode = 'reading' | 'terminal';

interface ReadingRow {
  key: string;
  runs: MeasuredReadingRun[];
}

/** One visual line: exactly `READING_LINE_HEIGHT` tall, so layout is exact. */
interface ReadingVisualLine {
  key: string;
  runs: readonly ReadingRun[];
}

function sameColor(
  left: TerminalGridColor | undefined,
  right: TerminalGridColor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.kind === right.kind
    && (left.kind === 'palette'
      ? left.index === (right as { index: number }).index
      : left.value === (right as { value: number }).value);
}

// Every span of every row is compared against its neighbour on each repaint, so
// this runs tens of thousands of times per frame on a full transcript.
// `JSON.stringify` made that the most expensive part of presenting a frame.
function sameStyle(left: TerminalGridStyle, right: TerminalGridStyle): boolean {
  return left.bold === right.bold
    && left.dim === right.dim
    && left.italic === right.italic
    && left.underline === right.underline
    && left.inverse === right.inverse
    && left.invisible === right.invisible
    && left.strikethrough === right.strikethrough
    && left.overline === right.overline
    && sameColor(left.foreground, right.foreground)
    && sameColor(left.background, right.background);
}

function rowRuns(row: TerminalGridRow): MeasuredReadingRun[] {
  const runs: MeasuredReadingRun[] = [];
  let column = 0;
  for (const span of row.spans) {
    if (span.column > column) {
      runs.push({
        width: span.column - column,
        text: ' '.repeat(span.column - column),
        style: {
          bold: false, dim: false, italic: false, underline: false,
          inverse: false, invisible: false, strikethrough: false, overline: false,
        },
      });
    }
    const previous = runs.at(-1);
    if (previous !== undefined && sameStyle(previous.style, span.style)) {
      previous.text += span.text;
      previous.width += span.width;
    } else runs.push({ width: span.width, text: span.text, style: span.style });
    column = span.column + span.width;
  }
  return runs;
}

/**
 * Drops the canvas filler under the last content row.
 *
 * A TUI canvas is as tall as the desktop window and pads the unused bottom with
 * blank rows — a real Claude panel measured 15 of 50. An exact grid can sit that
 * emptiness below the fold, but reflowed text would render it as a screenful of
 * void. Only the tail goes: blank rows in the middle are the app's own spacing.
 */
function rowHasInk(row: TerminalGridRow): boolean {
  return row.spans.some((span) => (
    span.text.trim().length > 0
    || span.style.background !== undefined
    || span.style.inverse
    || span.style.underline
    || span.style.strikethrough
    || span.style.overline
  ));
}

export function trimTrailingBlankRows(rows: readonly TerminalGridRow[]): readonly TerminalGridRow[] {
  let end = rows.length;
  while (end > 0 && !rowHasInk(rows[end - 1]!)) end -= 1;
  return end === rows.length ? rows : rows.slice(0, end);
}

/**
 * `baseRow` is the number of rows that already left this transcript, so a row
 * keeps the same key for as long as the phone holds it.
 *
 * The desktop ships a sliding window of history: once it is saturated, every new
 * line drops the oldest row and moves every remaining row one index down. Keyed
 * by position, FlatList then unmounts and remounts every cell on every line and
 * throws away the measured heights the scroll anchor depends on (dev-log 313).
 */
export function buildReadingRows(
  rows: readonly TerminalGridRow[],
  baseRow = 0,
): ReadingRow[] {
  const result: ReadingRow[] = [];
  for (const [index, row] of rows.entries()) {
    const runs = rowRuns(row);
    if (row.wrapped && result.length > 0) {
      const target = result[result.length - 1]!;
      for (const run of runs) {
        const previous = target.runs.at(-1);
        if (previous !== undefined && sameStyle(previous.style, run.style)) {
          previous.text += run.text;
          previous.width += run.width;
        } else target.runs.push({ ...run });
      }
      continue;
    }
    result.push({ key: `logical-${baseRow + index}`, runs });
  }
  return result;
}

function textStyle(
  style: TerminalGridStyle,
  theme: ConnectTheme,
  agent?: 'claude' | 'codex' | 'shell',
) {
  const terminalTheme = MOBILE_TERMINAL_THEMES[theme.mode];
  const codexInputSurface = agent === 'codex' && isCodexInputBackgroundColor(style.background);
  const foreground = resolveMobileTerminalColor(
    style.foreground,
    terminalTheme.foreground,
    theme.mode,
  );
  const background = resolveMobileTerminalColor(
    style.background,
    terminalTheme.background,
    theme.mode,
  );
  return {
    color: style.inverse ? background : foreground,
    backgroundColor: style.inverse
      ? foreground
      : codexInputSurface ? terminalTheme.background
        : style.background === undefined ? undefined : background,
    fontWeight: style.bold ? '700' as const : '400' as const,
    fontStyle: style.italic ? 'italic' as const : 'normal' as const,
    opacity: style.invisible ? 0 : style.dim ? 0.6 : 1,
    textDecorationLine: [
      style.underline ? 'underline' : '',
      style.strikethrough ? 'line-through' : '',
    ].filter(Boolean).join(' ') as 'none' | 'underline' | 'line-through' | 'underline line-through',
  };
}

export const NativeTerminalGridView = memo(function NativeTerminalGridView({
  frame,
  operationId,
  onMouse,
  onPaint,
  onViewport,
  presentation,
  fontFamily = 'menlo',
  agent,
  theme,
}: {
  frame: NativeTerminalGridState;
  operationId?: string;
  onMouse?(input: {
    action: 'press' | 'release' | 'wheel-up' | 'wheel-down';
    button: 0;
    column: number;
    row: number;
  }): void;
  onPaint?(operationId: string): void;
  /** Geometry this phone can present, for the takeover-time PTY handover. */
  onViewport?(cols: number, rows: number): void;
  presentation: 'reflow-view' | 'exact-grid-view';
  /** The user's terminal font; both are monospaced at the same advance. */
  fontFamily?: TerminalFontPreference;
  agent?: 'claude' | 'codex' | 'shell';
  theme: ConnectTheme;
}): React.ReactElement {
  // The presentation setting decides, on both buffers. Alternate-screen frames
  // used to be forced into the exact grid, which made the default Reflow View
  // unreachable for Claude Code and Codex — the only apps this product runs.
  const mode: PresentationMode = presentation === 'exact-grid-view' ? 'terminal' : 'reading';
  const fontStyle = fontFamily === 'jetbrains-mono' ? styles.jetBrainsMono : styles.menlo;
  const rows = useMemo(() => [...frame.historyRows, ...frame.viewportRows], [frame]);
  const readingRows = useMemo(
    () => buildReadingRows(trimTrailingBlankRows(rows), frame.omittedLines),
    [frame.omittedLines, rows],
  );
  const [readingWidth, setReadingWidth] = useState(0);
  const readingColumns = useMemo(() => {
    // Before the container reports a width there is nothing to wrap against.
    // Guessing would be worse than not wrapping: a zero width floors the budget
    // at one column and the first frame renders one character per line.
    if (readingWidth <= 0) return Number.MAX_SAFE_INTEGER;
    return Math.max(1, Math.floor((readingWidth - READING_PADDING_X * 2) / READING_CELL_WIDTH));
  }, [readingWidth]);
  /**
   * Wrapping here rather than in `<Text>` is what makes every item one line
   * tall, which is what lets the list state an exact `getItemLayout` instead of
   * estimating unmeasured cells (see `readingWrap.ts`).
   */
  const readingLines = useMemo<ReadingVisualLine[]>(() => {
    const lines: ReadingVisualLine[] = [];
    for (const row of readingRows) {
      for (const [index, line] of wrapReadingRuns(row.runs, readingColumns).entries()) {
        lines.push({ key: `${row.key}#${index}`, runs: line.runs });
      }
    }
    return lines;
  }, [readingColumns, readingRows]);
  const listRef = useRef<FlatList>(null);
  const follow = useRef(INITIAL_TERMINAL_FOLLOW_STATE);
  const [showLatest, setShowLatest] = useState(false);
  const reducedMotion = useReducedMotion();
  const paintedOperation = useRef<string | null>(null);
  const pendingPaint = useRef<string | null>(null);
  const onPaintRef = useRef(onPaint);
  onPaintRef.current = onPaint;
  const canPaint = onPaint !== undefined;
  const touchStart = useRef<{ x: number; y: number; atMs: number } | null>(null);
  const horizontalOffset = useRef(0);
  const verticalOffset = useRef(0);
  const [gridWidth, setGridWidth] = useState(0);
  const onViewportRef = useRef(onViewport);
  onViewportRef.current = onViewport;
  const reportViewport = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const viewport = mode === 'reading'
      ? terminalReadingViewport(width, height)
      : terminalGridViewport(width, height);
    onViewportRef.current?.(viewport.cols, viewport.rows);
  }, [mode]);
  // An alternate-screen canvas cannot reflow, so it is scaled to fit instead of
  // clipped. Falls back to panning only when the fit would stop being readable.
  const metrics = useMemo(
    () => terminalGridMetrics(frame.cols, gridWidth),
    [frame.cols, gridWidth],
  );
  const canvasWidth = frame.cols * metrics.cellWidth;

  /**
   * Reports the paint the swap coordinator is waiting for.
   *
   * A live panel pushes frames faster than one animation frame, so the report
   * has to survive the renders that land on top of it. The operation is held in
   * a ref rather than read off the current props: a later frame that arrives
   * without one is more output for the same unfinished paint, not a withdrawal.
   * The callback is a ref too — it is an inline closure upstream, so keeping it
   * in the dependency list cancelled the pending frame on every render. Nothing
   * is marked painted while the route owns no callback, or the report would be
   * swallowed and the header would spin forever.
   */
  useEffect(() => {
    if (operationId !== undefined && operationId !== paintedOperation.current) {
      pendingPaint.current = operationId;
    }
    const target = pendingPaint.current;
    if (target === null || !canPaint) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      paintedOperation.current = target;
      pendingPaint.current = null;
      onPaintRef.current?.(target);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [canPaint, operationId]);

  const dispatchFollow = useCallback((event: TerminalFollowEvent) => {
    const next = terminalFollowNext(follow.current, event);
    follow.current = next;
    setShowLatest(terminalFollowShowsLatestControl(next));
  }, []);

  /**
   * Puts the list on the newest row, against the *measured* content.
   *
   * `FlatList.scrollToEnd` targets `getCellMetricsApprox` of the last cell —
   * RN's own comment is "scrollToEnd may be janky without getItemLayout prop".
   * With rows it has not measured yet it estimates, and an estimate that falls
   * short stops the list above the real bottom; the measurement pass that
   * follows changes the content size and sends it chasing itself. The
   * ScrollView underneath knows the real size, so ask it (dev-log 313).
   */
  const anchorToLatest = useCallback((animated: boolean): void => {
    const list = listRef.current;
    if (list === null) return;
    const scrollView = list.getNativeScrollRef() as {
      scrollToEnd?(options?: { animated?: boolean }): void;
    } | null | undefined;
    if (typeof scrollView?.scrollToEnd === 'function') scrollView.scrollToEnd({ animated });
    else list.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    dispatchFollow({ kind: 'reset' });
    const animationFrame = requestAnimationFrame(() => {
      anchorToLatest(false);
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [anchorToLatest, dispatchFollow, frame.panelId, mode]);

  /**
   * Asks the app itself for output older than anything Connect recorded.
   *
   * An alternate-screen app keeps its transcript inside itself; Connect can only
   * record rows that left the canvas, which on a tall desktop window is almost
   * nothing. Reaching further back means sending the same wheel the desktop
   * sends. Whether this phone may write at all is decided upstream, against the
   * ownership epoch and the write scope — this only decides when to ask.
   */
  const lastWheelAtMs = useRef(0);
  const dragging = useRef(false);
  const requestOlderOutput = useCallback((
    offsetY: number,
    contentHeight: number,
    viewportHeight: number,
  ) => {
    if (frame.screen !== 'alternate' || onMouse === undefined) return;
    // The way back matters as much: once the app has scrolled its own view,
    // only a wheel-down returns it — the phone's list has nothing to show.
    // Only a finger may ask for it; follow-latest lands on the bottom by itself.
    const bottomOffset = Math.max(0, contentHeight - viewportHeight);
    const action = offsetY <= -WHEEL_REQUEST_OVERSCROLL_PX
      ? 'wheel-up'
      : dragging.current && offsetY >= bottomOffset + WHEEL_REQUEST_OVERSCROLL_PX
        ? 'wheel-down'
        : null;
    if (action === null) return;
    const now = Date.now();
    if (now - lastWheelAtMs.current < WHEEL_REQUEST_INTERVAL_MS) return;
    lastWheelAtMs.current = now;
    onMouse({
      action,
      button: 0,
      column: Math.max(0, Math.min(frame.cols - 1, Math.floor(frame.cols / 2))),
      row: Math.max(0, Math.min(frame.rows - 1, Math.floor(frame.rows / 2))),
    });
  }, [frame.cols, frame.rows, frame.screen, onMouse]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    verticalOffset.current = contentOffset.y;
    dispatchFollow({
      kind: 'scroll',
      atLatest: terminalScrollAtLatest({
        contentHeight: contentSize.height,
        offsetY: contentOffset.y,
        viewportHeight: layoutMeasurement.height,
      }),
      offsetY: contentOffset.y,
    });
    requestOlderOutput(contentOffset.y, contentSize.height, layoutMeasurement.height);
  }, [dispatchFollow, requestOlderOutput]);
  const followLatest = useCallback(() => {
    // Virtualized cells are measured lazily, so content size keeps changing
    // while the user drags upward. Never steal the anchor from a live gesture.
    if (terminalFollowAllowsAutoScroll(follow.current)) anchorToLatest(false);
  }, [anchorToLatest]);
  const beginBrowsing = useCallback(() => {
    dragging.current = true;
    dispatchFollow({ kind: 'dragBegin' });
  }, [dispatchFollow]);
  const endBrowsing = useCallback(() => {
    dragging.current = false;
    dispatchFollow({ kind: 'dragEnd' });
  }, [dispatchFollow]);
  const beginMomentum = useCallback(() => {
    dispatchFollow({ kind: 'momentumBegin' });
  }, [dispatchFollow]);
  const endMomentum = useCallback(() => {
    dispatchFollow({ kind: 'momentumEnd' });
  }, [dispatchFollow]);
  const returnToLatest = useCallback(() => {
    dispatchFollow({ kind: 'returnToLatest' });
    anchorToLatest(!reducedMotion);
  }, [anchorToLatest, dispatchFollow, reducedMotion]);
  const onGridTouchStart = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    touchStart.current = {
      x: event.nativeEvent.locationX,
      y: event.nativeEvent.locationY,
      atMs: Date.now(),
    };
  }, []);
  const onGridTouchEnd = useCallback((event: NativeSyntheticEvent<NativeTouchEvent>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start === null || mode !== 'terminal' || onMouse === undefined) return;
    const { locationX, locationY } = event.nativeEvent;
    if (Date.now() - start.atMs >= LONG_PRESS_SELECTION_MS) return;
    if (Math.abs(locationX - start.x) > 10 || Math.abs(locationY - start.y) > 10) return;
    const column = Math.floor((locationX + horizontalOffset.current) / metrics.cellWidth);
    // The list also scrolls Connect's own alternate-screen history, so the tap
    // must be resolved against the document before it can name a PTY row.
    const documentRow = Math.floor((locationY + verticalOffset.current) / metrics.lineHeight);
    const row = documentRow - frame.historyRows.length;
    if (row < 0 || row >= frame.rows) return;
    onMouse({ action: 'press', button: 0, column, row });
    onMouse({ action: 'release', button: 0, column, row });
  }, [frame.historyRows.length, frame.rows, metrics.cellWidth, metrics.lineHeight, mode, onMouse]);
  const onHorizontalScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    horizontalOffset.current = event.nativeEvent.contentOffset.x;
  }, []);

  if (mode === 'reading') {
    return (
      <View
        onLayout={(event) => {
          reportViewport(event);
          setReadingWidth(event.nativeEvent.layout.width);
        }}
        style={[styles.container, { backgroundColor: theme.colors.panel }]}
      >
        <FlatList
          contentContainerStyle={styles.readingContent}
          data={readingLines}
          // Every item is one wrapped line of `READING_LINE_HEIGHT`, so the list
          // never has to estimate an unmeasured cell. Estimating is what moved
          // content under readers scrolling up through history.
          getItemLayout={(_data, index) => ({
            length: READING_LINE_HEIGHT,
            offset: READING_LINE_HEIGHT * index,
            index,
          })}
          initialNumToRender={40}
          keyExtractor={(item) => item.key}
          maxToRenderPerBatch={80}
          onContentSizeChange={followLatest}
          onLayout={followLatest}
          onMomentumScrollBegin={beginMomentum}
          onMomentumScrollEnd={endMomentum}
          onScroll={onScroll}
          onScrollBeginDrag={beginBrowsing}
          onScrollEndDrag={endBrowsing}
          removeClippedSubviews
          ref={listRef}
          renderItem={({ item, index }) => (
            <Text
              allowFontScaling={false}
              // Wrapping already happened by column; one item is one line.
              numberOfLines={1}
              selectable
              style={[styles.readingRow, fontStyle, { color: theme.colors.text }]}
              testID={`native-terminal-reading-row-${index}`}
            >
              {item.runs.map((run: ReadingRun, runIndex: number) => (
                <Text
                  allowFontScaling={false}
                  key={`${item.key}-${runIndex}`}
                  style={textStyle(run.style, theme, agent)}
                >
                  {forceTextPresentation(run.text)}
                </Text>
              ))}
            </Text>
          )}
          scrollEventThrottle={16}
          style={styles.content}
          testID="native-terminal-reading"
          windowSize={15}
        />
        {showLatest ? (
          <MotionPressable
            accessibilityLabel={t('回到最新')}
            accessibilityRole="button"
            onPress={returnToLatest}
            style={[styles.latestButton, { backgroundColor: theme.colors.panel2, borderColor: theme.colors.line2 }]}
          >
            <ArrowDown color={theme.colors.text} size={18} />
          </MotionPressable>
        ) : null}
      </View>
    );
  }

  return (
    <View
      onLayout={reportViewport}
      style={[styles.container, { backgroundColor: MOBILE_TERMINAL_THEMES[theme.mode].background }]}
    >
      <ScrollView
        horizontal
        onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
        onScroll={onHorizontalScroll}
        onTouchEnd={onGridTouchEnd}
        onTouchStart={onGridTouchStart}
        scrollEnabled={metrics.overflows}
        showsHorizontalScrollIndicator={metrics.overflows}
        contentContainerStyle={{ width: canvasWidth }}
        style={styles.content}
        testID="native-terminal-grid-pane"
      >
        <FlatList
          contentContainerStyle={[styles.gridContent, { width: canvasWidth }]}
          data={rows}
          // Every canvas row is exactly one line tall, so the list never has to
          // estimate where the bottom is (dev-log 313).
          getItemLayout={(_data, index) => ({
            length: metrics.lineHeight,
            offset: index * metrics.lineHeight,
            index,
          })}
          initialNumToRender={50}
          keyExtractor={(_item, index) => `grid-${index}`}
          maxToRenderPerBatch={100}
          onContentSizeChange={followLatest}
          onLayout={followLatest}
          onMomentumScrollBegin={beginMomentum}
          onMomentumScrollEnd={endMomentum}
          onScroll={onScroll}
          onScrollBeginDrag={beginBrowsing}
          onScrollEndDrag={endBrowsing}
          removeClippedSubviews
          ref={listRef}
          renderItem={({ item, index }) => (
            <View style={[styles.gridRow, { height: metrics.lineHeight, width: canvasWidth }]}>
              {item.spans.map((span: TerminalGridSpan, spanIndex: number) => (
                <Text
                  allowFontScaling={false}
                  key={`${index}-${spanIndex}`}
                  numberOfLines={1}
                  selectable
                  style={[
                    styles.gridSpan,
                    fontStyle,
                    textStyle(span.style, theme, agent),
                    {
                      fontSize: metrics.fontSize,
                      height: metrics.lineHeight,
                      lineHeight: metrics.lineHeight,
                      left: span.column * metrics.cellWidth,
                      width: span.width * metrics.cellWidth,
                    },
                  ]}
                >
                  {forceTextPresentation(span.text)}
                </Text>
              ))}
              {index === frame.historyRows.length + (frame.cursor?.row ?? -1)
                && frame.cursor?.visible ? (
                  <View style={[
                    styles.cursor,
                    {
                      left: frame.cursor.column * metrics.cellWidth,
                      width: metrics.cellWidth,
                      height: metrics.lineHeight - 4,
                      backgroundColor: MOBILE_TERMINAL_THEMES[theme.mode].cursor,
                    },
                  ]} />
                ) : null}
            </View>
          )}
          scrollEventThrottle={16}
          testID="native-terminal-grid"
          windowSize={15}
        />
      </ScrollView>
      {showLatest ? (
        <MotionPressable
          accessibilityLabel={t('回到最新')}
          accessibilityRole="button"
          onPress={returnToLatest}
          style={[styles.latestButton, { backgroundColor: theme.colors.panel2, borderColor: theme.colors.line2 }]}
        >
          <ArrowDown color={theme.colors.text} size={18} />
        </MotionPressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  content: { flex: 1 },
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
  // Terminals grow upward, so a transcript shorter than the viewport sits at
  // the bottom rather than leaving a void under it — same as the exact grid.
  readingContent: {
    paddingHorizontal: READING_PADDING_X,
    paddingTop: READING_PADDING_TOP,
    paddingBottom: READING_PADDING_BOTTOM,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  // Menlo 是 iOS 系统字体；Android 上不存在，未知 family 会退到非等宽的系统默认字体，
  // 网格对齐就断了。选了 Menlo 的用户在 Android 上落到随包的 JetBrains Mono。
  menlo: Platform.OS === 'ios' ? { fontFamily: 'Menlo' } as const : { fontFamily: 'JetBrains Mono' } as const,
  // Registered by the expo-font plugin under its family name, so bold and
  // italic resolve to the bundled faces.
  jetBrainsMono: { fontFamily: 'JetBrains Mono' },
  readingRow: {
    fontSize: READING_FONT_SIZE,
    height: READING_LINE_HEIGHT,
    lineHeight: READING_LINE_HEIGHT,
    letterSpacing: 0,
  },
  // Terminals grow upward: a canvas shorter than the viewport sits at the
  // bottom rather than leaving a void under it.
  gridContent: { flexGrow: 1, justifyContent: 'flex-end' },
  gridRow: { position: 'relative' },
  gridSpan: {
    position: 'absolute',
    top: 0,
    letterSpacing: 0,
  },
  cursor: {
    position: 'absolute',
    top: 2,
    opacity: 0.35,
  },
});
