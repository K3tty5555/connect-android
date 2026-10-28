import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ChevronLeft, ChevronRight, RotateCw, Undo2 } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BROWSER_KEY_WHITELIST,
  type MobileBrowserKeyName,
} from '../../../../src/shared/mobileBrowserMirror';
import {
  browserCenteredPan,
  browserClampPan,
  browserDisplayGeometry,
  browserPointerFromTouch,
  browserResumeAction,
  browserWheelFromDrag,
  type BrowserMirrorState,
  type DisplayedBrowserFrame,
} from '../domain/browserMirrorSession';
import type { BrowserFrameHost } from '../domain/browserFrameHost';
import type { BrowserLastFrame } from '../domain/browserLastFrame';
import { t } from '../i18n';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from '../components/MotionPressable';

/**
 * 网页镜像观看器（ADR-003 §19，设计 §5.5）。
 *
 * 画面默认**撑满观看区**（cover，2026-10-28 修订）：宽帧贴合高度左右平移、
 * 高帧贴合宽度上下平移，双指缩放仍只改本地显示。帧本体经 BrowserFrameHost
 * 直达画面叶子——每帧只重渲这一处，不带动整棵 App 树（否则真机每帧数百毫秒、
 * 帧率坍缩）。操作与终端同规则：先显式接管、epoch、桌面随时收回。
 * 帧是 JPEG：RN Image 以 data URI 渲染，双端一致、零新依赖。
 */

const MAX_ZOOM = 4;
const MIN_ZOOM = 1;
const TAP_SLOP_PX = 12;
const WHEEL_SEND_INTERVAL_MS = 120;
/**
 * 宽面板（iPad 主区）里「操作网页」的上限（用户拍板 2026-10-27）：横屏近 700pt 的通栏
 * 按钮失衡；手机操作条到不了这个宽度，样式分文不动。超过阈值时按钮封顶并靠右，
 * 与左侧导航键（后退/前进/刷新）形成「导航在左、主操作在右」的分组。
 */
const WIDE_ACTION_BAR_MIN_WIDTH = 440;
const TAKEOVER_BUTTON_MAX_WIDTH = 320;

const KEY_LABELS: ReadonlyArray<{ key: MobileBrowserKeyName; label: string }> = [
  { key: 'backspace', label: '删除' },
  { key: 'enter', label: '回车' },
  { key: 'tab', label: 'Tab' },
  { key: 'escape', label: 'Esc' },
  { key: 'arrow-left', label: '←' },
  { key: 'arrow-up', label: '↑' },
  { key: 'arrow-down', label: '↓' },
  { key: 'arrow-right', label: '→' },
  { key: 'home', label: '行首' },
  { key: 'end', label: '行尾' },
  { key: 'page-up', label: '上翻页' },
  { key: 'page-down', label: '下翻页' },
];

export interface BrowserMirrorScreenProps {
  state: BrowserMirrorState;
  /** 帧通道：画面本体与 Ack 簿记都在这里，不进 App 状态。 */
  frameHost: BrowserFrameHost;
  theme: ConnectTheme;
  workspaceLabel: string;
  online: boolean;
  /** 设备有 write scope（与终端接管同一口径）。 */
  canWrite: boolean;
  /** 一行克制提示（错误码映射的结果）；null 不显示。 */
  notice: { tone: 'info' | 'warn'; text: string } | null;
  /** 本地缓存的上次画面：首帧到达前安静地垫着。 */
  cachedFrame: BrowserLastFrame | null;
  /**
   * 手机是全屏 Modal；iPad 平板壳里它是主区的一个标签页（`pane`），
   * 顶部安全区由标签条让出，关闭由标签上的 × 或这里的返回键。
   */
  chrome?: 'modal' | 'pane';
  onBack(): void;
  /** 手机显示完一帧才确认（在途帧数由桌面保证）。 */
  onAckFrame(browserCapability: string, seq: number): void;
  onTakeover(browserCapability: string, currentEpoch: number | undefined): void;
  onNav(browserCapability: string, action: 'back' | 'forward' | 'reload'): void;
  onPointer(
    browserCapability: string,
    baseFrameSeq: number,
    action: 'tap' | 'down' | 'move' | 'up',
    x: number,
    y: number,
  ): void;
  onWheel(browserCapability: string, baseFrameSeq: number, deltaX: number, deltaY: number): void;
  onInsertText(browserCapability: string, baseFrameSeq: number, text: string): void;
  onKey(browserCapability: string, baseFrameSeq: number, key: MobileBrowserKeyName): void;
  /** 暂停后非输入通道的恢复：重开观看流。 */
  onResume(): void;
}

interface GestureTouch {
  pageX: number;
  pageY: number;
}

/** 帧叶子：只随 host 的帧重渲（App 树与观看器其余部分不感知每帧变化）。 */
function FrameImage({
  frameHost,
  container,
  zoom,
  pan,
  onDisplayed,
}: {
  frameHost: BrowserFrameHost;
  container: { width: number; height: number };
  zoom: number;
  pan: { x: number; y: number };
  onDisplayed(frame: DisplayedBrowserFrame): void;
}): React.ReactElement | null {
  const frame = useSyncExternalStore(
    frameHost.subscribe,
    () => frameHost.frame,
  );
  if (frame === null || container.width <= 0 || container.height <= 0) return null;
  const geometry = browserDisplayGeometry({
    containerWidth: container.width,
    containerHeight: container.height,
    encodedWidth: frame.encodedWidth,
    encodedHeight: frame.encodedHeight,
  });
  return (
    <View
      style={{
        width: geometry.width,
        height: geometry.height,
        overflow: 'hidden',
        transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: zoom }],
      }}
    >
      <Image
        accessibilityLabel={t('网页画面')}
        onLoad={() => onDisplayed(frame)}
        resizeMode="cover"
        source={{ uri: `data:image/jpeg;base64,${frame.jpegBase64}` }}
        style={{ width: geometry.width, height: geometry.height }}
        testID="browser-frame-image"
      />
    </View>
  );
}

export function BrowserMirrorScreen({
  state,
  frameHost,
  theme,
  workspaceLabel,
  online,
  canWrite,
  notice,
  cachedFrame,
  chrome = 'modal',
  onBack,
  onAckFrame,
  onTakeover,
  onNav,
  onPointer,
  onWheel,
  onInsertText,
  onKey,
  onResume,
}: BrowserMirrorScreenProps): React.ReactElement {
  const view = state.view;
  // 平板壳里顶部由标签条让出、左边是侧栏；只认右和底的安全区（与文件标签页同口径）。
  const safeAreaEdges = chrome === 'pane'
    ? (['right', 'bottom'] as const)
    : (['top', 'left', 'right'] as const);
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [actionBarWidth, setActionBarWidth] = useState(0);
  const actionBarWide = actionBarWidth >= WIDE_ACTION_BAR_MIN_WIDTH;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState('');
  const styles = useMemo(() => createStyles(theme), [theme]);
  // 画面有无只需要翻布尔：观看器因首帧出现/清空才重渲，不为每帧买单。
  const hasFrame = useSyncExternalStore(
    frameHost.subscribe,
    () => frameHost.hasFrame,
  );

  // 换面板即复位本地缩放与输入；新页面从撑满观看区重新看起。
  const browserCapability = view?.browserCapability;
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDraft('');
  }, [browserCapability]);

  const controlled = view?.controlledByThisDevice === true && view.epoch !== null;
  const canInput = controlled && hasFrame && online;
  const displayedCached = !hasFrame && cachedFrame !== null;
  // 观看器关掉后 host 可能还留着最后一帧：帧的确认只对当前打开的面板有效。
  const currentCapabilityRef = useRef<string | null>(view?.browserCapability ?? null);
  currentCapabilityRef.current = view?.browserCapability ?? null;

  const handleFrameDisplayed = useCallback((frame: DisplayedBrowserFrame): void => {
    // 同一帧只确认一次：host 的簿记按序号拦下重复 load。
    const ack = frameHost.ackForDisplayed();
    if (ack === null || ack.seq !== frame.seq) return;
    const bcap = currentCapabilityRef.current;
    if (bcap === null) return;
    onAckFrame(bcap, ack.seq);
  }, [frameHost, onAckFrame]);

  // 手势状态走 ref：PanResponder 只建一次，读到的永远是最新值。
  /** 手势层的页面原点：pageX/pageY 换回画面局部坐标用（测试环境无 measure，回 0）。 */
  const surfaceRef = useRef<View | null>(null);
  const surfaceOriginRef = useRef({ x: 0, y: 0 });
  const gestureRef = useRef({
    pinchStartDistance: 0,
    pinchStartZoom: 1,
    pinchStartPan: { x: 0, y: 0 },
    pinchStartMid: { x: 0, y: 0 },
    touchStart: { x: 0, y: 0 },
    moved: false,
    lastWheelAt: 0,
    dragAccumX: 0,
    dragAccumY: 0,
  });
  const latest = useRef({
    zoom, pan, canInput, container, frameHost, controlled, onPointer, onWheel,
    capability: view?.browserCapability ?? null,
  });
  latest.current = {
    zoom, pan, canInput, container, frameHost, controlled, onPointer, onWheel,
    capability: view?.browserCapability ?? null,
  };

  /** 事件时（而非渲染时）取当前画面几何：帧与容器谁变都以最新值为准。 */
  const geometryNow = useCallback((): { width: number; height: number } | null => {
    const current = latest.current;
    const frame = current.frameHost.frame;
    if (frame === null || current.container.width <= 0) return null;
    return browserDisplayGeometry({
      containerWidth: current.container.width,
      containerHeight: current.container.height,
      encodedWidth: frame.encodedWidth,
      encodedHeight: frame.encodedHeight,
    });
  }, []);

  /** 画面比例或观看区尺寸变化时，本地平移回到居中基准（缩放回到 1）。 */
  const geometryAspect = (() => {
    const frame = frameHost.frame;
    if (frame === null || container.width <= 0 || container.height <= 0) return 0;
    return Math.round((frame.encodedWidth / Math.max(1, frame.encodedHeight)) * 1000) * 1000
      + Math.round(container.width) * 100 + Math.round(container.height);
  })();
  useEffect(() => {
    setZoom(MIN_ZOOM);
    const geometry = geometryNow();
    setPan(geometry === null
      ? { x: 0, y: 0 }
      : browserCenteredPan(geometry, { width: container.width, height: container.height }));
    // geometryAspect 编码了帧比例与容器尺寸；任一变化都重置观看基准。
  }, [geometryAspect, geometryNow, container.width, container.height]);

  const clampPan = (nextPan: { x: number; y: number }, nextZoom: number): { x: number; y: number } => {
    return browserClampPan(nextPan, nextZoom, geometryNow(), latest.current.container);
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      const gesture = gestureRef.current;
      const surface = surfaceRef.current;
      if (surface !== null && typeof surface.measureInWindow === 'function') {
        surface.measureInWindow((x, y) => {
          surfaceOriginRef.current = { x: x ?? 0, y: y ?? 0 };
        });
      }
      const touches = (event.nativeEvent.touches ?? []) as GestureTouch[];
      if (touches.length >= 2) {
        const [first, second] = touches;
        gesture.pinchStartDistance = Math.hypot(
          second.pageX - first.pageX, second.pageY - first.pageY,
        ) || 1;
        gesture.pinchStartZoom = latest.current.zoom;
        gesture.pinchStartPan = { ...latest.current.pan };
        gesture.pinchStartMid = {
          x: (first.pageX + second.pageX) / 2,
          y: (first.pageY + second.pageY) / 2,
        };
        gesture.moved = true;
        return;
      }
      const touch = touches[0] ?? (event.nativeEvent as GestureTouch);
      gesture.touchStart = { x: touch.pageX, y: touch.pageY };
      gesture.moved = false;
      gesture.dragAccumX = 0;
      gesture.dragAccumY = 0;
      gesture.lastWheelAt = event.nativeEvent.timestamp ?? Date.now();
    },
    onPanResponderMove: (event) => {
      const gesture = gestureRef.current;
      const touches = (event.nativeEvent.touches ?? []) as GestureTouch[];
      if (touches.length >= 2) {
        const [first, second] = touches;
        const distance = Math.hypot(second.pageX - first.pageX, second.pageY - first.pageY) || 1;
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.pinchStartZoom * distance / gesture.pinchStartDistance));
        // 锚住双指中点：缩放围绕手指进行，而不是围绕画面左上角。
        const mid = { x: (first.pageX + second.pageX) / 2, y: (first.pageY + second.pageY) / 2 };
        const ratio = nextZoom / gesture.pinchStartZoom;
        const nextPan = {
          x: mid.x - (gesture.pinchStartMid.x - gesture.pinchStartPan.x) * ratio,
          y: mid.y - (gesture.pinchStartMid.y - gesture.pinchStartPan.y) * ratio,
        };
        setZoom(nextZoom);
        setPan(clampPan(nextPan, nextZoom));
        return;
      }
      const touch = touches[0] ?? (event.nativeEvent as GestureTouch);
      const dx = touch.pageX - gesture.touchStart.x;
      const dy = touch.pageY - gesture.touchStart.y;
      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) gesture.moved = true;
      const current = latest.current;
      if (current.zoom > 1) {
        // 放大检视时单指只平移本地画面，不向页面发滚轮。
        setPan(clampPan({ x: current.pan.x + (touch.pageX - gesture.touchStart.x) - (gesture.dragAccumX), y: current.pan.y + (touch.pageY - gesture.touchStart.y) - (gesture.dragAccumY) }, current.zoom));
        gesture.dragAccumX = touch.pageX - gesture.touchStart.x;
        gesture.dragAccumY = touch.pageY - gesture.touchStart.y;
        return;
      }
      if (!current.canInput) return;
      const image = geometryNow();
      if (image === null) return;
      gesture.dragAccumX = touch.pageX - gesture.touchStart.x;
      gesture.dragAccumY = touch.pageY - gesture.touchStart.y;
      const now = event.nativeEvent.timestamp ?? Date.now();
      if (now - gesture.lastWheelAt < WHEEL_SEND_INTERVAL_MS) return;
      gesture.lastWheelAt = now;
      const frame = current.frameHost.frame;
      const wheel = browserWheelFromDrag({
        dragDownPx: gesture.dragAccumY,
        dragRightPx: gesture.dragAccumX,
        imageWidth: image.width,
        frame: {
          viewportWidth: frame?.viewportWidth ?? 0,
          viewportHeight: frame?.viewportHeight ?? 0,
          encodedWidth: frame?.encodedWidth ?? 0,
          encodedHeight: frame?.encodedHeight ?? 0,
        },
      });
      gesture.touchStart = { x: touch.pageX, y: touch.pageY };
      if (frame !== null && current.capability !== null) {
        current.onWheel(current.capability, frame.seq, wheel.deltaX, wheel.deltaY);
      }
    },
    onPanResponderRelease: (event) => {
      const gesture = gestureRef.current;
      const current = latest.current;
      const touches = (event.nativeEvent.touches ?? []) as GestureTouch[];
      if (touches.length > 0) return;
      if (current.zoom > MIN_ZOOM) {
        if (current.zoom < 1.05) {
          setZoom(MIN_ZOOM);
          const geometry = geometryNow();
          setPan(geometry === null
            ? { x: 0, y: 0 }
            : browserCenteredPan(geometry, latest.current.container));
        }
        return;
      }
      const touch = (event.nativeEvent as GestureTouch & { touches?: GestureTouch[] }).touches?.[0]
        ?? (event.nativeEvent as GestureTouch);
      const tapX = touch.pageX ?? gesture.touchStart.x;
      const tapY = touch.pageY ?? gesture.touchStart.y;
      if (!gesture.moved) {
        // 轻点：未接管时什么都不发（操作要先进「操作网页」）。
        if (!current.canInput) return;
        const image = geometryNow();
        if (image === null) return;
        const frame = current.frameHost.frame;
        if (frame === null) return;
        const origin = surfaceOriginRef.current;
        const pointer = browserPointerFromTouch({
          touchX: tapX - origin.x, touchY: tapY - origin.y,
          scale: current.zoom,
          panX: current.pan.x, panY: current.pan.y,
          imageWidth: image.width, imageHeight: image.height,
        });
        if (current.capability === null) return;
        current.onPointer(current.capability, frame.seq, 'tap', pointer.x, pointer.y);
        return;
      }
      // 拖动收尾：把余量一次性送出。
      const image = geometryNow();
      const frame = current.frameHost.frame;
      if (current.canInput && image !== null && frame !== null && current.capability !== null
        && (Math.abs(gesture.dragAccumY) > 2 || Math.abs(gesture.dragAccumX) > 2)) {
        const wheel = browserWheelFromDrag({
          dragDownPx: gesture.dragAccumY,
          dragRightPx: gesture.dragAccumX,
          imageWidth: image.width,
          frame: {
            viewportWidth: frame.viewportWidth,
            viewportHeight: frame.viewportHeight,
            encodedWidth: frame.encodedWidth,
            encodedHeight: frame.encodedHeight,
          },
        });
        current.onWheel(current.capability, frame.seq, wheel.deltaX, wheel.deltaY);
      }
    },
    onPanResponderTerminate: () => {
      gestureRef.current.moved = true;
    },
  }), [clampPan, geometryNow]);

  if (view === null) {
    return (
      <SafeAreaView edges={safeAreaEdges} style={styles.root}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>{t('当前没有可看的网页')}</Text>
          <MotionPressable
            accessibilityLabel={t('返回')}
            accessibilityRole="button"
            onPress={onBack}
            style={styles.headerButton}
          >
            <ChevronLeft color={theme.colors.text2} size={23} />
          </MotionPressable>
        </View>
      </SafeAreaView>
    );
  }

  const bcap = view.browserCapability;
  const canNav = controlled && online;
  const otherDeviceOperating = view.owner === 'mobile' && !view.controlledByThisDevice;
  const pausedOverlay = view.phase === 'paused';

  const submitDraft = (event: { nativeEvent: { text?: string } }): void => {
    // 事件携带的是输入法上屏后的最终文本，比闭包里的 draft 更权威。
    const value = event.nativeEvent.text ?? draft;
    const frame = frameHost.frame;
    if (value.length === 0 || frame === null) return;
    onInsertText(bcap, frame.seq, value);
    setDraft('');
  };

  const sendKey = (key: MobileBrowserKeyName): void => {
    const frame = frameHost.frame;
    if (frame === null) return;
    onKey(bcap, frame.seq, key);
  };

  return (
    <SafeAreaView edges={safeAreaEdges} style={styles.root}>
      <View style={styles.header} testID="browser-mirror-header">
        <MotionPressable
          accessibilityLabel={chrome === 'pane' ? t('关闭') : t('返回项目')}
          accessibilityRole="button"
          onPress={onBack}
          style={styles.headerButton}
        >
          <ChevronLeft color={theme.colors.text2} size={23} />
        </MotionPressable>
        <View style={styles.titleCopy}>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.title}>
            {view.title || workspaceLabel}
          </Text>
          <Text style={styles.subtitle}>
            {online ? (
              otherDeviceOperating ? t('另一台设备正在操作') : (
                view.loading ? t('正在载入') : t('网页')
              )
            ) : t('连接已断开')}
          </Text>
        </View>
      </View>
      {notice !== null ? (
        <Text
          numberOfLines={1}
          style={[styles.notice, notice.tone === 'warn' ? styles.noticeWarn : styles.noticeInfo]}
        >
          {t(notice.text)}
        </Text>
      ) : null}
      {view.tier === 'congested' ? (
        <Text numberOfLines={1} style={styles.tierNotice}>{t('网络较慢，已降低画质')}</Text>
      ) : null}
      <View
        onLayout={(event) => setContainer({
          width: event.nativeEvent.layout.width,
          height: event.nativeEvent.layout.height,
        })}
        style={styles.frameArea}
        testID="browser-frame-area"
      >
        {hasFrame ? (
          <View
            ref={surfaceRef}
            style={StyleSheet.absoluteFill}
            {...panResponder.panHandlers}
            testID="browser-touch-surface"
          >
            <FrameImage
              container={container}
              frameHost={frameHost}
              onDisplayed={handleFrameDisplayed}
              pan={pan}
              zoom={zoom}
            />
          </View>
        ) : displayedCached && cachedFrame !== null ? (
          <View style={StyleSheet.absoluteFill}>
            <Image
              accessibilityLabel={t('上次画面')}
              resizeMode="contain"
              source={{ uri: `data:image/jpeg;base64,${cachedFrame.jpegBase64}` }}
              style={styles.cachedImage}
              testID="browser-frame-image"
            />
            <Text style={styles.cachedLabel}>{t('上次画面')}</Text>
          </View>
        ) : view.phase === 'starting' || view.phase === 'live' ? (
          <View style={styles.emptyState} testID="browser-loading">
            <ActivityIndicator color={theme.colors.text2} />
            <Text style={styles.emptyText}>{t('正在打开…')}</Text>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{online ? t('网页画面已停止') : t('连接已断开')}</Text>
          </View>
        )}
        {pausedOverlay ? (
          <Pressable
            accessibilityLabel={t('继续')}
            accessibilityRole="button"
            onPress={(event) => {
              const channel = browserResumeAction(view);
              if (channel.kind === 'view_restart') {
                onResume();
                return;
              }
              // 输入通道：轻点位置送进页面；拿不到触点就送中性的 wheel(0,0) 唤醒。
              const touch = (event.nativeEvent as GestureTouch & { touches?: GestureTouch[] }).touches?.[0]
                ?? (event.nativeEvent as GestureTouch);
              const image = geometryNow();
              const origin = surfaceOriginRef.current;
              const frame = frameHost.frame;
              if (typeof touch?.pageX === 'number' && typeof touch?.pageY === 'number' && image !== null) {
                const pointer = browserPointerFromTouch({
                  touchX: touch.pageX - origin.x, touchY: touch.pageY - origin.y,
                  scale: zoom, panX: pan.x, panY: pan.y,
                  imageWidth: image.width, imageHeight: image.height,
                });
                if (view.epoch !== null && frame !== null) {
                  onPointer(bcap, frame.seq, 'tap', pointer.x, pointer.y);
                  return;
                }
              }
              if (view.epoch !== null && frame !== null) onWheel(bcap, frame.seq, 0, 0);
            }}
            style={styles.pausedOverlay}
          >
            <Text style={styles.pausedText}>{t('已暂停，轻点继续')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        onLayout={(event) => setActionBarWidth(event.nativeEvent.layout.width)}
        style={styles.actionBar}
        testID="browser-action-bar"
      >
        <MotionPressable
          accessibilityLabel={t('后退')}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canNav || !view.canGoBack }}
          disabled={!canNav || !view.canGoBack}
          onPress={() => onNav(bcap, 'back')}
          style={[styles.actionButton, !canNav || !view.canGoBack ? styles.actionDisabled : null]}
        >
          <Undo2 color={theme.colors.text} size={19} />
        </MotionPressable>
        <MotionPressable
          accessibilityLabel={t('前进')}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canNav || !view.canGoForward }}
          disabled={!canNav || !view.canGoForward}
          onPress={() => onNav(bcap, 'forward')}
          style={[styles.actionButton, !canNav || !view.canGoForward ? styles.actionDisabled : null]}
        >
          <ChevronRight color={theme.colors.text} size={19} />
        </MotionPressable>
        <MotionPressable
          accessibilityLabel={t('刷新')}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canNav }}
          disabled={!canNav}
          onPress={() => onNav(bcap, 'reload')}
          style={[styles.actionButton, !canNav ? styles.actionDisabled : null]}
        >
          <RotateCw color={theme.colors.text} size={18} />
        </MotionPressable>
        {online && canWrite && !controlled ? (
          <MotionPressable
            accessibilityLabel={t('操作网页')}
            accessibilityRole="button"
            onPress={() => onTakeover(bcap, view.epoch ?? undefined)}
            style={[styles.takeoverButton, actionBarWide ? styles.takeoverButtonWide : null]}
          >
            <Text style={styles.takeoverText}>{t('操作网页')}</Text>
          </MotionPressable>
        ) : null}
      </View>
      {controlled ? (
        <View style={styles.inputArea}>
          <TextInput
            accessibilityLabel={t('输入文字')}
            maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE}
            onChangeText={setDraft}
            onSubmitEditing={submitDraft}
            placeholder={t('输入文字，回车发送')}
            placeholderTextColor={theme.colors.text3}
            returnKeyType="send"
            style={styles.inputField}
            testID="browser-insert-field"
            value={draft}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keyRow}
          >
            {KEY_LABELS.map((entry) => (
              <MotionPressable
                accessibilityLabel={t(entry.label)}
                accessibilityRole="button"
                key={entry.key}
                onPress={() => sendKey(entry.key)}
                style={styles.keyButton}
              >
                <Text style={styles.keyLabel}>{t(entry.label)}</Text>
              </MotionPressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    header: {
      minHeight: 56,
      paddingHorizontal: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x1,
    },
    headerButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleCopy: { minWidth: 0, flex: 1, paddingHorizontal: SPACE.x1 },
    title: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
    subtitle: { color: theme.colors.text3, fontSize: 11, marginTop: 1 },
    notice: { paddingHorizontal: SPACE.x3, paddingVertical: SPACE.x1, fontSize: 12 },
    noticeInfo: { color: theme.colors.text2 },
    noticeWarn: { color: theme.colors.warn },
    tierNotice: {
      paddingHorizontal: SPACE.x3,
      paddingVertical: SPACE.x1,
      color: theme.colors.text3,
      fontSize: 12,
    },
    frameArea: { flex: 1, backgroundColor: theme.colors.panel, overflow: 'hidden' },
    cachedImage: { flex: 1, opacity: 0.85 },
    cachedLabel: {
      position: 'absolute',
      top: SPACE.x2,
      alignSelf: 'center',
      color: theme.colors.text3,
      fontSize: 11,
      backgroundColor: theme.colors.panel2,
      paddingHorizontal: SPACE.x2,
      paddingVertical: 2,
      borderRadius: RADIUS.pill,
      overflow: 'hidden',
    },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.x2 },
    emptyText: { color: theme.colors.text3, fontSize: 13 },
    pausedOverlay: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.overlay,
    },
    pausedText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
    actionBar: {
      minHeight: 52,
      paddingHorizontal: SPACE.x2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
      backgroundColor: theme.colors.panel,
    },
    actionButton: {
      minWidth: 44,
      height: 40,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.panel2,
      paddingHorizontal: SPACE.x2,
    },
    actionDisabled: { opacity: 0.4 },
    takeoverButton: {
      minHeight: 40,
      flex: 1,
      marginLeft: SPACE.x2,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.accent,
      paddingHorizontal: SPACE.x3,
    },
    /** 只在宽面板下叠加：封顶 + 靠右；手机版式不受影响。 */
    takeoverButtonWide: { maxWidth: TAKEOVER_BUTTON_MAX_WIDTH, marginLeft: 'auto' },
    takeoverText: { color: theme.colors.bg, fontSize: 14, fontWeight: '700' },
    inputArea: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.panel,
      paddingHorizontal: SPACE.x2,
      paddingVertical: SPACE.x2,
      gap: SPACE.x2,
    },
    inputField: {
      minHeight: 40,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel2,
      color: theme.colors.text,
      paddingHorizontal: SPACE.x3,
      fontSize: 15,
    },
    keyRow: { gap: SPACE.x1, paddingRight: SPACE.x2 },
    keyButton: {
      minHeight: 34,
      minWidth: 44,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel2,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: SPACE.x2,
    },
    keyLabel: { color: theme.colors.text2, fontSize: 13 },
  });
}

export const BROWSER_MIRROR_KEY_COUNT = BROWSER_KEY_WHITELIST.length;
