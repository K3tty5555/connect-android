import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import {
  ConnectTerminalNativeView,
  type ConnectTerminalViewInstance,
} from '../../modules/connect-terminal';
import type { TerminalFontPreference } from '../../../../src/shared/types';
import type { ConnectTheme } from '../theme/theme';
import { planGridVt, type GridVtState } from './gridToVt';
import { SwiftTermLatestButton } from './SwiftTermLatestButton';
import { swiftTermPalette } from './SwiftTermTerminalView';
import type { NativeTerminalGridState } from './terminalGridModel';
import { READING_FONT_SIZE } from './terminalGridMetrics';
import { MotionPressable } from '../components/MotionPressable';
import { t } from '../i18n';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';

type MouseInput = {
  action: 'press' | 'release' | 'wheel-up' | 'wheel-down';
  button: 0;
  column: number;
  row: number;
};

/**
 * SwiftTerm drawing the desktop's grid frames.
 *
 * The same frames, paint reports, geometry and wheel as the native grid view,
 * so everything above treats the two alike. What SwiftTerm adds is a real
 * terminal: full-screen apps' recorded history is its own scrollback, read
 * and scrolled on the phone without a takeover or a round trip.
 */
export const SwiftTermGridView = memo(function SwiftTermGridView({
  frame,
  operationId,
  onMouse,
  onPaint,
  onViewport,
  fontFamily,
  agent,
  theme,
  keyboardOpen = false,
  onDismissKeyboard,
  probe = false,
}: {
  frame: NativeTerminalGridState;
  operationId?: string;
  onMouse?(input: MouseInput): void;
  onPaint?(operationId: string): void;
  onViewport?(cols: number, rows: number): void;
  fontFamily: TerminalFontPreference;
  agent?: 'claude' | 'codex' | 'shell';
  theme: ConnectTheme;
  /** System or in-app keyboard is taking screen height from the terminal. */
  keyboardOpen?: boolean;
  onDismissKeyboard?(): void;
  probe?: boolean;
}): React.ReactElement {
  const nativeRef = useRef<ConnectTerminalViewInstance>(null);
  /** Commands wait until the native view exists (see ConnectTerminalView.onReady). */
  const ready = useRef(false);
  const drawn = useRef<GridVtState | null>(null);
  const latest = useRef({ frame, operationId, agent });
  latest.current = { frame, operationId, agent };
  const claimedOperation = useRef<string | null>(null);
  const scheduled = useRef<number | null>(null);
  const onPaintRef = useRef(onPaint);
  const onViewportRef = useRef(onViewport);
  const onMouseRef = useRef(onMouse);
  onPaintRef.current = onPaint;
  onViewportRef.current = onViewport;
  onMouseRef.current = onMouse;
  const palette = useMemo(() => swiftTermPalette(theme.mode), [theme.mode]);
  /** What the container holds at the preferred font size, as the native view last reported. */
  const [fit, setFit] = useState<{ cols: number; rows: number } | null>(null);
  /** Up in the local scrollback, as the native view last reported. */
  const [browsing, setBrowsing] = useState(false);
  // The keyboard does not resize the PTY (it would reflow the Mac for a
  // moment's typing), so a canvas laid out for the full height overhangs and
  // its top rows sit out of sight (acceptance F-04). Counted only at phone
  // width, where the font is the preferred size and the fit rows measure it.
  const hiddenRows = keyboardOpen && fit !== null && frame.cols <= fit.cols
    ? Math.max(0, frame.rows - fit.rows)
    : 0;

  const draw = useCallback((): void => {
    scheduled.current = null;
    const view = nativeRef.current;
    if (view === null || !ready.current) return;
    const current = latest.current;
    const plan = planGridVt(drawn.current, current.frame, current.agent);
    drawn.current = plan.next;
    // Claimed only while someone listens: a paint reported to no one would be
    // swallowed and leave the swap waiting for it (as in NativeTerminalGridView).
    const operation = onPaintRef.current !== undefined
      && current.operationId !== undefined
      && current.operationId !== claimedOperation.current
      ? current.operationId
      : null;
    if (operation !== null) claimedOperation.current = operation;
    void view.apply(plan.commands, operation).catch(() => {
      // Nothing is known to be on screen any more: the next frame rebuilds, and
      // the operation it could not paint may be claimed by it again.
      drawn.current = null;
      if (operation !== null && claimedOperation.current === operation) claimedOperation.current = null;
    });
  }, []);

  // Frames can arrive faster than the screen refreshes; only the newest of
  // each refresh is drawn.
  const scheduleDraw = useCallback((): void => {
    if (scheduled.current !== null) return;
    scheduled.current = requestAnimationFrame(draw);
  }, [draw]);

  const canPaint = onPaint !== undefined;
  useEffect(() => {
    scheduleDraw();
  }, [canPaint, frame, operationId, scheduleDraw]);

  useEffect(() => {
    // Another agent colours differently: redraw everything once.
    drawn.current = null;
    scheduleDraw();
  }, [agent, scheduleDraw]);

  useEffect(() => () => {
    if (scheduled.current !== null) cancelAnimationFrame(scheduled.current);
  }, []);

  const NativeView = ConnectTerminalNativeView;
  if (NativeView === null) {
    return <View style={[styles.container, { backgroundColor: palette.background }]} />;
  }
  return (
    <View style={styles.container}>
    <NativeView
      fontFamily={fontFamily}
      onBrowsing={(event) => setBrowsing(event.nativeEvent.browsing)}
      onFit={(event) => {
        const { cols, rows } = event.nativeEvent;
        setFit((previous) => (previous?.cols === cols && previous.rows === rows ? previous : { cols, rows }));
        onViewportRef.current?.(cols, rows);
      }}
      onPainted={(event) => onPaintRef.current?.(event.nativeEvent.operationId)}
      onReady={() => {
        ready.current = true;
        drawn.current = null;
        scheduleDraw();
      }}
      onWheel={(event) => {
        const { cols, rows } = latest.current.frame;
        onMouseRef.current?.({
          action: event.nativeEvent.direction === 'up' ? 'wheel-up' : 'wheel-down',
          button: 0,
          column: Math.floor(cols / 2),
          row: Math.floor(rows / 2),
        });
      }}
      palette={palette}
      preferredFontSize={READING_FONT_SIZE}
      probe={probe}
      ref={nativeRef}
      style={[styles.container, { backgroundColor: palette.background }]}
      testID="terminal-swiftterm-grid"
      wheelAtEdges={frame.screen === 'alternate' && onMouse !== undefined}
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
    {hiddenRows > 0 ? (
      <View
        style={[styles.hiddenRows, { backgroundColor: theme.colors.panel2, borderColor: theme.colors.line2 }]}
        testID="swiftterm-hidden-rows"
      >
        <Text
          maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE}
          numberOfLines={1}
          style={[styles.hiddenRowsText, { color: theme.colors.text2 }]}
        >
          {t('键盘遮住了顶部 {count} 行', { count: hiddenRows })}
        </Text>
        {onDismissKeyboard ? (
          <MotionPressable
            accessibilityLabel={t('收起键盘')}
            accessibilityRole="button"
            hitSlop={SPACE.x2}
            onPress={onDismissKeyboard}
            style={styles.hiddenRowsAction}
          >
            <ChevronDown color={theme.colors.text2} size={15} />
            <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={[styles.hiddenRowsText, { color: theme.colors.text }]}>
              {t('收起键盘')}
            </Text>
          </MotionPressable>
        ) : null}
      </View>
    ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  hiddenRows: {
    position: 'absolute',
    top: SPACE.x2,
    left: SPACE.x2,
    right: SPACE.x2,
    minHeight: 34,
    paddingHorizontal: SPACE.x3,
    borderRadius: RADIUS.control,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.x2,
  },
  hiddenRowsText: { flexShrink: 1, fontSize: 12 },
  hiddenRowsAction: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: SPACE.x1 },
});
