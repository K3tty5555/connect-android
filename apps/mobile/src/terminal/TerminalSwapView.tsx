import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import type { AgentKind } from '../domain/session';
import type { ConnectTheme } from '../theme/theme';
import {
  TerminalWebView,
  type TerminalRestoreState,
  type TerminalWebViewHandle,
} from './TerminalWebView';
import type { TerminalSegment } from './terminalSegments';
import {
  SwiftTermTerminalView,
  swiftTermAvailable,
  type TerminalWheelInput,
} from './SwiftTermTerminalView';
import type { TerminalFontPreference } from '../../../../src/shared/types';

interface TerminalSlotIdentity {
  agent: AgentKind;
  panelId: string;
}

interface PendingReplacement {
  data: string | readonly TerminalSegment[];
  operationId: string;
  preserveAnchor: boolean;
  restore: TerminalRestoreState;
  slot: 0 | 1;
  version: number;
}

export interface TerminalSwapViewProps {
  agent: AgentKind;
  /** Which view renders the byte stream; SwiftTerm falls back to the WebView where absent. */
  renderer?: 'webview' | 'swiftterm';
  fontFamily?: TerminalFontPreference;
  /** Wheel notches from the SwiftTerm view; only the visible slot sends. */
  onMouse?(input: TerminalWheelInput): void;
  panelId: string;
  theme: ConnectTheme;
  onResize(cols: number, rows: number): void;
  onRecoveryNeeded?(): void;
  onPaint?(operationId: string): void;
  onRenderStage?(
    operationId: string,
    stage: 'webview_received' | 'vt_parsed' | 'frame_committed',
  ): void;
}

/** Keeps the last painted terminal visible while the newest target renders off-screen. */
export const TerminalSwapView = forwardRef<TerminalWebViewHandle, TerminalSwapViewProps>(
  function TerminalSwapView({
    agent,
    renderer = 'webview',
    fontFamily = 'menlo',
    onMouse,
    panelId,
    theme,
    onResize,
    onRecoveryNeeded,
    onPaint,
    onRenderStage,
  }, forwardedRef) {
    const slotRefs = [
      useRef<TerminalWebViewHandle>(null),
      useRef<TerminalWebViewHandle>(null),
    ] as const;
    const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
    const [mountedSlots, setMountedSlots] = useState<[boolean, boolean]>([true, false]);
    const activeSlotRef = useRef<0 | 1>(0);
    const pendingRef = useRef<PendingReplacement | null>(null);
    const nextVersionRef = useRef(1);
    const [replacementVersion, setReplacementVersion] = useState(0);
    const [slotIdentities, setSlotIdentities] = useState<[
      TerminalSlotIdentity,
      TerminalSlotIdentity,
    ]>([
      { agent, panelId },
      { agent, panelId },
    ]);
    const slotIdentitiesRef = useRef(slotIdentities);
    slotIdentitiesRef.current = slotIdentities;
    const enabledSlotsRef = useRef<[boolean, boolean]>([true, false]);
    const onPaintRef = useRef(onPaint);
    const onRecoveryNeededRef = useRef(onRecoveryNeeded);
    const onRenderStageRef = useRef(onRenderStage);
    const onResizeRef = useRef(onResize);
    const onMouseRef = useRef(onMouse);
    onMouseRef.current = onMouse;
    onPaintRef.current = onPaint;
    onRecoveryNeededRef.current = onRecoveryNeeded;
    onRenderStageRef.current = onRenderStage;
    onResizeRef.current = onResize;

    const deliverySlot = (): 0 | 1 => pendingRef.current?.slot ?? activeSlotRef.current;

    useImperativeHandle(forwardedRef, () => ({
      cancelReplacement(operationId): void {
        const pending = pendingRef.current;
        if (pending?.operationId !== operationId) return;
        pendingRef.current = null;
        enabledSlotsRef.current = activeSlotRef.current === 0
          ? [true, false]
          : [false, true];
        slotRefs[pending.slot].current?.cancelReplacement(operationId);
      },
      replace(data, restore = {}, renderOperationId): void {
        if (renderOperationId === undefined) {
          slotRefs[deliverySlot()].current?.replace(data, restore);
          return;
        }
        const slot = activeSlotRef.current === 0 ? 1 : 0;
        const version = nextVersionRef.current;
        nextVersionRef.current += 1;
        const preserveAnchor = slotIdentitiesRef.current[slot].panelId === panelId;
        pendingRef.current = {
          data,
          operationId: renderOperationId,
          preserveAnchor,
          restore,
          slot,
          version,
        };
        enabledSlotsRef.current = [true, true];
        slotIdentitiesRef.current = slot === 0
          ? [{ agent, panelId }, slotIdentitiesRef.current[1]]
          : [slotIdentitiesRef.current[0], { agent, panelId }];
        setSlotIdentities((current) => {
          const next: [TerminalSlotIdentity, TerminalSlotIdentity] = [
            current[0],
            current[1],
          ];
          next[slot] = { agent, panelId };
          return next;
        });
        setMountedSlots((current) => {
          if (current[slot]) return current;
          const next: [boolean, boolean] = [current[0], current[1]];
          next[slot] = true;
          return next;
        });
        setReplacementVersion(version);
      },
      write(data, geometry, renderOperationId): void {
        slotRefs[deliverySlot()].current?.write(data, geometry, renderOperationId);
      },
      setGeometry(geometry): void {
        slotRefs[deliverySlot()].current?.setGeometry(geometry);
      },
      reportOutputLoss(lines): void {
        slotRefs[deliverySlot()].current?.reportOutputLoss(lines);
      },
      reportOutputTrimmed(lines): void {
        slotRefs[deliverySlot()].current?.reportOutputTrimmed(lines);
      },
      reportRecoveryStarted(): void {
        slotRefs[deliverySlot()].current?.reportRecoveryStarted();
      },
      reportRecoveryFailed(): void {
        slotRefs[deliverySlot()].current?.reportRecoveryFailed();
      },
      scrollToBottom(): void {
        slotRefs[deliverySlot()].current?.scrollToBottom();
      },
    }), [agent, panelId]);

    useLayoutEffect(() => {
      const pending = pendingRef.current;
      if (pending === null || pending.version !== replacementVersion) return;
      if (!pending.preserveAnchor) slotRefs[pending.slot].current?.scrollToBottom();
      slotRefs[pending.slot].current?.replace(
        pending.data,
        pending.restore,
        pending.operationId,
      );
    }, [replacementVersion]);

    const receivePaint = useCallback((slot: 0 | 1, operationId: string): void => {
      const pending = pendingRef.current;
      if (pending !== null) {
        if (pending.slot !== slot || pending.operationId !== operationId) return;
        pendingRef.current = null;
        activeSlotRef.current = slot;
        enabledSlotsRef.current = slot === 0 ? [true, false] : [false, true];
        setActiveSlot(slot);
        onPaintRef.current?.(operationId);
        return;
      }
      if (activeSlotRef.current === slot) onPaintRef.current?.(operationId);
    }, []);
    const paintHandlers = [
      useCallback((operationId: string) => receivePaint(0, operationId), [receivePaint]),
      useCallback((operationId: string) => receivePaint(1, operationId), [receivePaint]),
    ] as const;
    const recoveryHandlers = [
      useCallback(() => {
        if (enabledSlotsRef.current[0]) onRecoveryNeededRef.current?.();
      }, []),
      useCallback(() => {
        if (enabledSlotsRef.current[1]) onRecoveryNeededRef.current?.();
      }, []),
    ] as const;
    const renderStageHandlers = [
      useCallback((operationId: string, stage: 'webview_received' | 'vt_parsed' | 'frame_committed') => {
        if (enabledSlotsRef.current[0]) onRenderStageRef.current?.(operationId, stage);
      }, []),
      useCallback((operationId: string, stage: 'webview_received' | 'vt_parsed' | 'frame_committed') => {
        if (enabledSlotsRef.current[1]) onRenderStageRef.current?.(operationId, stage);
      }, []),
    ] as const;
    const resizeHandlers = [
      useCallback((cols: number, rows: number) => {
        if (enabledSlotsRef.current[0]) onResizeRef.current(cols, rows);
      }, []),
      useCallback((cols: number, rows: number) => {
        if (enabledSlotsRef.current[1]) onResizeRef.current(cols, rows);
      }, []),
    ] as const;

    const useSwiftTerm = renderer === 'swiftterm' && swiftTermAvailable;
    const mouseHandlers = [
      (input: TerminalWheelInput) => {
        if (activeSlotRef.current === 0) onMouseRef.current?.(input);
      },
      (input: TerminalWheelInput) => {
        if (activeSlotRef.current === 1) onMouseRef.current?.(input);
      },
    ] as const;
    const pendingSlot = pendingRef.current?.slot ?? null;
    enabledSlotsRef.current = [
      activeSlot === 0 || pendingSlot === 0,
      activeSlot === 1 || pendingSlot === 1,
    ];

    return (
      <View style={[styles.container, { backgroundColor: theme.colors.panel }]}>
        {([0, 1] as const).map((slot) => {
          if (!mountedSlots[slot]) return null;
          const visible = activeSlot === slot;
          const identity = slotIdentities[slot];
          return (
            <View
              accessibilityElementsHidden={!visible}
              importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
              key={slot}
              pointerEvents={visible ? 'auto' : 'none'}
              style={[styles.slot, visible ? styles.visible : styles.hidden]}
              testID={`terminal-swap-slot-${slot}`}
            >
              {useSwiftTerm ? (
                <SwiftTermTerminalView
                  agent={identity.agent}
                  fontFamily={fontFamily}
                  onMouse={mouseHandlers[slot]}
                  panelId={identity.panelId}
                  onPaint={paintHandlers[slot]}
                  onRecoveryNeeded={recoveryHandlers[slot]}
                  onRenderStage={renderStageHandlers[slot]}
                  onResize={resizeHandlers[slot]}
                  ref={slotRefs[slot]}
                  theme={theme}
                />
              ) : (
                <TerminalWebView
                  agent={identity.agent}
                  panelId={identity.panelId}
                  onPaint={paintHandlers[slot]}
                  onRecoveryNeeded={recoveryHandlers[slot]}
                  onRenderStage={renderStageHandlers[slot]}
                  onResize={resizeHandlers[slot]}
                  ref={slotRefs[slot]}
                  theme={theme}
                />
              )}
            </View>
          );
        })}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  slot: {
    position: 'absolute',
    inset: 0,
  },
  visible: {
    opacity: 1,
    zIndex: 1,
  },
  hidden: {
    opacity: 0,
    zIndex: 0,
  },
});
