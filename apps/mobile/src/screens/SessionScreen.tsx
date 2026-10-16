import { type Ref, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { RefreshCw, ScanLine } from 'lucide-react-native';
import {
  KeyboardAvoidingView,
  KeyboardController,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import type {
  ConnectionState,
  MobileIntent,
  SessionPanelSummary,
  SessionViewModel,
  SessionWorkspaceSummary,
  SurfaceKind,
} from '../domain/session';
import { canCompose, ownershipIntent } from '../domain/session';
import { currentPlatformPolicy } from '../platform/policy';
import { useAndroidBack } from '../platform/useAndroidBack';
import { useMobileRouteActive } from '../navigation/routeActivity';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';
import { panelDisplayLabel } from '../domain/panelLabel';
import { Composer } from '../components/Composer';
import { ConnectionBar } from '../components/ConnectionBar';
import { PanelSwitcher } from '../components/PanelSwitcher';
import { TaskActionBar } from '../components/TaskActionBar';
import { TerminalFeed } from '../components/TerminalFeed';
import { MobileRoomChat } from '../components/MobileRoomChat';
import { TerminalQuickKeys } from '../components/TerminalQuickKeys';
import { SurfaceCreateSheet } from '../components/SurfaceCreateSheet';
import { MotionPressable } from '../components/MotionPressable';
import {
  type TerminalWebViewHandle,
} from '../terminal/TerminalWebView';
import { TerminalSwapView } from '../terminal/TerminalSwapView';
import { NativeTerminalGridView } from '../terminal/NativeTerminalGridView';
import { SwiftTermGridView } from '../terminal/SwiftTermGridView';
import { swiftTermAvailable } from '../terminal/SwiftTermTerminalView';
import { LastScreenView } from '../terminal/LastScreenView';
import type { LastScreen } from '../terminal/lastScreenStore';
import type { NativeTerminalGridState } from '../terminal/terminalGridModel';
import type {
  TerminalShortcutBindings,
  TerminalFontPreference,
  TerminalViewPreference,
} from '../../../../src/shared/types';
import type { TerminalKeyModifiers, TerminalKeyName } from '../../../../src/shared/terminalInput';
import { FullTerminalKeyboard } from '../terminal/FullTerminalKeyboard';
import type { MobileRoomMessage } from '../net/bridgeClient';
import type { PreparedRoomImage } from '../domain/roomImageTransfer';
import {
  operationPresentation,
  type OperationPhase,
} from '../domain/operationPresentation';
import type { RefreshStatus } from '../components/ProgressiveRefreshButton';
import { RoomImageViewer } from '../components/RoomImageViewer';
import { OperationGlyph } from '../components/OperationGlyph';
import { SurfaceLifecyclePlaceholder } from '../components/SurfaceLifecyclePlaceholder';

export interface SessionScreenProps {
  state: SessionViewModel;
  presentedConnection?: ConnectionState;
  theme: ConnectTheme;
  onIntent(intent: MobileIntent): void;
  onDraftChange(value: string): void;
  onDraftSubmit?(value: string): void;
  onPair?(): void;
  onPanelSelect?(panelId: string): void;
  onPanelsRefresh?(): void;
  onOwnershipReconcile?(): void;
  onTerminalInput?(data: string): void;
  onTerminalKey?(key: TerminalKeyName, modifiers: TerminalKeyModifiers): void;
  onTerminalPaste?(): void;
  onTerminalMouse?(input: {
    action: 'press' | 'release' | 'wheel-up' | 'wheel-down';
    button: 0;
    column: number;
    row: number;
  }): void;
  /**
   * `transient` marks a layout squeezed by input chrome the user opens and
   * closes (the in-app keyboard, the quick keys): not a shape worth a redraw.
   */
  onTerminalResize?(cols: number, rows: number, transient?: boolean): void;
  onTerminalRecoveryNeeded?(): void;
  terminalRendererFallback?: boolean;
  terminalRendererRetryPending?: boolean;
  onTerminalRendererRetry?(): void;
  onTerminalPaint?(operationId: string): void;
  onTerminalRenderStage?(
    operationId: string,
    stage: 'webview_received' | 'vt_parsed' | 'frame_committed',
  ): void;
  onComposerFocus?(): void;
  /** The keyboard shrinks this viewport; the PTY handover must ignore that. */
  onKeyboardVisibility?(visible: boolean): void;
  terminalRef?: Ref<TerminalWebViewHandle>;
  terminalView?: TerminalViewPreference;
  terminalFont?: TerminalFontPreference;
  /**
   * The terminal as it was last seen, from before this launch. Covers the live
   * view until its first paint; the caller stops passing it after that.
   */
  lastScreen?: LastScreen | null;
  /** 演示/UI 测试构建：SwiftTerm 视图暴露几何/最新行可见性（见 App.tsx NATIVE_GRID_DEMO） */
  terminalProbe?: boolean;
  terminalShortcuts?: TerminalShortcutBindings;
  terminalQueueDepth?: number;
  nativeGridPresentation?: { frame: NativeTerminalGridState; operationId?: string } | null;
  connectionDetail?: string | null;
  pairingRequired?: boolean;
  surfaceCreateStatus?: OperationPhase;
  surfaceCreateError?: string | null;
  onSurfaceCreate?(workspaceCapability: string, kind: SurfaceKind): void;
  onSurfaceCreateDismiss?(): void;
  surfaceCloseStatus?: OperationPhase;
  composerSendStatus?: OperationPhase;
  refreshStatus?: RefreshStatus;
  terminalSwapStatus?: OperationPhase;
  onSurfaceClose?(panelId: string, epoch: number): boolean | void;
  roomMessages?: readonly MobileRoomMessage[];
  roomOmittedMessages?: number;
  collaborationAvatar?: string | null;
  roomComposerImages?: readonly PreparedRoomImage[];
  roomImagePickPending?: boolean;
  terminalComposerImages?: readonly PreparedRoomImage[];
  terminalImagePickPending?: boolean;
  roomImageViewer?: { open: boolean; uri: string | null; pending: boolean; error: string | null };
  onRoomImagePick?(): void;
  onRoomImageRemove?(id: string): void;
  onTerminalImagePick?(): void;
  onTerminalImageRemove?(id: string): void;
  onRoomImageOpen?(messageId: string, imageIndex: number): void;
  onRoomImageViewerClose?(): void;
  visibleWorkspaces?: readonly SessionWorkspaceSummary[];
  switcherPanels?: Readonly<SessionViewModel['panels']>;
  switcherWorkspaces?: readonly SessionWorkspaceSummary[];
  onBackToProject?(): void;
}

const ignorePanel = (_panelId: string): void => {};
const ignoreTerminalInput = (_data: string): void => {};
const ignoreTerminalResize = (_cols: number, _rows: number): void => {};
const ignoreRefresh = (): void => {};

export function SessionScreen({
  state,
  presentedConnection = state.connection,
  theme,
  onIntent,
  onDraftChange,
  onDraftSubmit,
  onPair,
  onPanelSelect = ignorePanel,
  onPanelsRefresh = ignoreRefresh,
  onOwnershipReconcile,
  onTerminalInput = ignoreTerminalInput,
  onTerminalKey,
  onTerminalPaste,
  onTerminalMouse,
  onTerminalResize = ignoreTerminalResize,
  onTerminalRecoveryNeeded,
  terminalRendererFallback = false,
  terminalRendererRetryPending = false,
  onTerminalRendererRetry,
  onTerminalPaint,
  onTerminalRenderStage,
  onComposerFocus,
  onKeyboardVisibility,
  terminalRef,
  terminalView = 'webview',
  terminalFont = 'menlo',
  lastScreen = null,
  terminalProbe = false,
  terminalShortcuts,
  terminalQueueDepth = 0,
  nativeGridPresentation = null,
  connectionDetail,
  pairingRequired = false,
  surfaceCreateStatus = 'idle',
  surfaceCreateError = null,
  onSurfaceCreate,
  onSurfaceCreateDismiss,
  surfaceCloseStatus = 'idle',
  composerSendStatus = 'idle',
  refreshStatus = 'idle',
  terminalSwapStatus = 'idle',
  onSurfaceClose,
  roomMessages = [],
  roomOmittedMessages = 0,
  collaborationAvatar = null,
  roomComposerImages = [],
  roomImagePickPending = false,
  terminalComposerImages = [],
  terminalImagePickPending = false,
  roomImageViewer = { open: false, uri: null, pending: false, error: null },
  onRoomImagePick,
  onRoomImageRemove,
  onTerminalImagePick,
  onTerminalImageRemove,
  onRoomImageOpen,
  onRoomImageViewerClose,
  visibleWorkspaces = state.workspaces,
  switcherPanels = state.panels,
  switcherWorkspaces = state.workspaces,
  onBackToProject,
}: SessionScreenProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const routeActive = useMobileRouteActive();
  const policy = currentPlatformPolicy();
  const previousOwnership = useRef(state.ownership);
  const [quickKeysExpanded, setQuickKeysExpanded] = useState(false);
  const [createSheetOpen, setCreateSheetOpen] = useState(false);
  const [pendingSurface, setPendingSurface] = useState<{
    workspaceCapability: string;
    kind: SurfaceKind;
  } | null>(null);
  const [closingSurface, setClosingSurface] = useState<{
    panel: SessionPanelSummary;
    index: number;
  } | null>(null);
  const [createSurfacePreparing, setCreateSurfacePreparing] = useState(false);
  const [createPrepareError, setCreatePrepareError] = useState<string | null>(null);
  const createPrepareTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminalResizeRef = useRef(onTerminalResize);
  terminalResizeRef.current = onTerminalResize;
  const inputChromeOpenRef = useRef(false);
  const forwardTerminalResize = useCallback((cols: number, rows: number) => {
    terminalResizeRef.current(cols, rows, inputChromeOpenRef.current);
  }, []);
  const activePanel = state.panels.find((panel) => panel.panelId === state.activePanelId) ?? null;
  const isCollaboration = activePanel?.kind === 'collaboration';
  const supportsTerminalImages = activePanel?.kind === 'claude' || activePanel?.kind === 'codex';
  const visibleOwnershipAuthority = state.ownership === 'desktop_owned'
    || state.ownership === 'mobile_owned'
    || state.ownership === 'other_mobile_owned'
    ? state.ownership
    : state.ownershipAuthority;
  const interactionFrozen = pendingSurface !== null
    || (
      closingSurface !== null
      && closingSurface.panel.panelId === state.activePanelId
      && surfaceCloseStatus !== 'failed'
    );
  const composerAvailable = isCollaboration
    ? state.connection === 'online' && state.canControlInput && !state.isDemo
    : canCompose(state);
  const composerVisible = isCollaboration
    ? presentedConnection === 'online' && state.canControlInput && !state.isDemo
    : canCompose({ ...state, connection: presentedConnection });
  const terminalInputAvailable = !isCollaboration && composerAvailable
    && !interactionFrozen
    && !state.panelExited
    && state.pendingIntent === null
    && !state.isDemo;
  const keyboardVisible = useKeyboardState((keyboard) => keyboard.isVisible);
  // Entering a window never summons a keyboard. The on-screen full keyboard is
  // a toolbar action the user takes, and it lasts only for this window.
  const [inputSurface, setInputSurface] = useState<'system' | 'full-keyboard'>('system');
  const fullKeyboardAvailable = !isCollaboration && (terminalInputAvailable || state.isDemo);
  const fullKeyboardOpen = fullKeyboardAvailable && inputSurface === 'full-keyboard';
  const usesByteStream = terminalView === 'webview';
  inputChromeOpenRef.current = fullKeyboardOpen || quickKeysExpanded;

  useAndroidBack(state.draft, onBackToProject ? () => {
    onBackToProject();
    return true;
  } : undefined);

  useEffect(() => {
    const priorOwnership = previousOwnership.current;
    previousOwnership.current = state.ownership;
    if (
      priorOwnership === 'takeover_pending'
      && state.ownership === 'mobile_owned'
      && state.pendingIntent === null
      && !policy.handlesHardwareBack
    ) {
      KeyboardController.preload();
    }
  }, [policy.handlesHardwareBack, state.ownership, state.pendingIntent]);

  useEffect(() => {
    if (surfaceCreateStatus === 'completed') {
      setCreateSheetOpen(false);
      setPendingSurface(null);
    }
  }, [surfaceCreateStatus]);

  useEffect(() => {
    if (surfaceCloseStatus === 'failed') setClosingSurface(null);
  }, [surfaceCloseStatus]);

  // A window change, or losing the write control the keyboard needs, hands the
  // bottom of the screen back to the composer rather than leaving a keyboard
  // that would silently return the moment control came back.
  useEffect(() => {
    if (fullKeyboardAvailable) return;
    setInputSurface('system');
  }, [fullKeyboardAvailable]);

  useEffect(() => {
    setInputSurface('system');
  }, [state.activePanelId]);

  useEffect(() => {
    onKeyboardVisibility?.(keyboardVisible);
  }, [keyboardVisible, onKeyboardVisibility]);

  useEffect(() => () => {
    if (createPrepareTimer.current !== null) clearTimeout(createPrepareTimer.current);
  }, []);

  const activeWorkspaceCapability = state.panels.find(
    (panel) => panel.panelId === state.activePanelId,
  )?.workspaceCapability ?? state.workspaces[0]?.workspaceCapability ?? null;
  const canCreateSurface = state.connection === 'online'
    && state.canControlInput
    && state.workspaces.length > 0
    && !state.isDemo
    && onSurfaceCreate !== undefined;
  const canPrepareSurface = state.canControlInput
    && !state.isDemo
    && onSurfaceCreate !== undefined;
  const canCloseActiveSurface = state.connection === 'online'
    && state.canControlInput
    && state.activePanelId !== null
    && state.ownershipEpoch !== null
    && !state.panelExited
    && onSurfaceClose !== undefined
    && surfaceCloseStatus !== 'pending'
    && surfaceCloseStatus !== 'accepted'
    && surfaceCloseStatus !== 'streaming'
    && surfaceCloseStatus !== 'ambiguous'
    && !isCollaboration;

  useEffect(() => {
    if (!createSurfacePreparing || !canCreateSurface) return;
    if (createPrepareTimer.current !== null) clearTimeout(createPrepareTimer.current);
    createPrepareTimer.current = null;
    setCreateSurfacePreparing(false);
    setCreatePrepareError(null);
  }, [canCreateSurface, createSurfacePreparing]);

  const requestNewSurface = (): void => {
    if (!canPrepareSurface) return;
    setCreateSheetOpen(true);
    setCreatePrepareError(null);
    if (canCreateSurface) {
      return;
    }
    if (createSurfacePreparing) return;
    setCreateSurfacePreparing(true);
    if (state.connection === 'offline') onIntent('reconnect');
    else onPanelsRefresh();
    if (createPrepareTimer.current !== null) clearTimeout(createPrepareTimer.current);
    createPrepareTimer.current = setTimeout(() => {
      createPrepareTimer.current = null;
      setCreateSurfacePreparing(false);
      setCreatePrepareError(t('项目列表未能加载，请检查连接后重试。'));
    }, 5_000);
  };

  const confirmCloseActiveSurface = (): void => {
    const panel = switcherPanels.find((candidate) => candidate.panelId === state.activePanelId)
      ?? state.panels.find((candidate) => candidate.panelId === state.activePanelId);
    const epoch = state.ownershipEpoch;
    if (!panel || epoch === null || !canCloseActiveSurface || !onSurfaceClose) return;
    Alert.alert(
      t('关闭窗口？'),
      panelDisplayLabel(panel),
      [
        { text: t('取消'), style: 'cancel' },
        {
          text: t('关闭'),
          style: 'destructive',
          onPress: () => {
            setClosingSurface({
              panel,
              index: Math.max(0, switcherPanels.findIndex(
                (candidate) => candidate.panelId === panel.panelId,
              )),
            });
            if (onSurfaceClose(panel.panelId, epoch) === false) setClosingSurface(null);
          },
        },
      ],
    );
  };
  const surfaceLifecyclePresentation = pendingSurface ? (
    <SurfaceLifecyclePlaceholder
      error={surfaceCreateError}
      kind={pendingSurface.kind}
      onDismiss={() => {
        setPendingSurface(null);
        onSurfaceCreateDismiss?.();
      }}
      onRetry={() => onSurfaceCreate?.(
        pendingSurface.workspaceCapability,
        pendingSurface.kind,
      )}
      status={surfaceCreateStatus}
      theme={theme}
      variant="surface"
    />
  ) : null;

  return (
    <SafeAreaView
      edges={['top', 'left', 'right']}
      style={{ flex: 1, backgroundColor: theme.colors.bg }}
    >
      {!keyboardVisible && (state.connection === 'unpaired' || state.isDemo) ? (
        <ConnectionBar
          deviceName={state.deviceName}
          connection={presentedConnection}
          isDemo={state.isDemo}
          theme={theme}
        />
      ) : null}
      {state.connection !== 'unpaired' && !state.isDemo ? (
        <PanelSwitcher
          activePanelId={state.activePanelId}
          connection={presentedConnection}
          onRefresh={onPanelsRefresh}
          refreshStatus={refreshStatus}
          onSelect={onPanelSelect}
          onQuickKeysToggle={() => setQuickKeysExpanded((expanded) => !expanded)}
          onNewSurface={requestNewSurface}
          canCreateSurface={canCreateSurface}
          canPrepareSurface={canPrepareSurface}
          createSurfacePreparing={createSurfacePreparing}
          canCloseActiveSurface={canCloseActiveSurface}
          closeSurfaceStatus={surfaceCloseStatus}
          closingPanel={closingSurface?.panel ?? null}
          closingPanelIndex={closingSurface?.index ?? -1}
          onCloseExitComplete={() => setClosingSurface(null)}
          onCloseActiveSurface={confirmCloseActiveSurface}
          onBack={onBackToProject}
          panels={switcherPanels}
          workspaces={switcherWorkspaces}
          quickKeysAvailable={terminalInputAvailable}
          quickKeysExpanded={quickKeysExpanded}
          ownership={isCollaboration ? null : state.ownership}
          ownershipAuthority={isCollaboration ? null : visibleOwnershipAuthority}
          ownershipIntent={isCollaboration ? null : ownershipIntent(state)}
          canControlInput={state.canControlInput}
          onOwnershipIntent={onIntent}
          onOwnershipReconcile={onOwnershipReconcile}
          sessionSwitchStatus={terminalSwapStatus}
          theme={theme}
        />
      ) : null}
      {state.connection === 'unpaired' ? (
        <View
          accessible
          accessibilityLabel={t('尚未绑定电脑')}
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text style={{ color: theme.colors.text3 }}>
            {t(connectionDetail ?? '在电脑端打开 Connect 配对')}
          </Text>
          {onPair ? <PairButton label={t('扫描二维码')} onPress={onPair} theme={theme} /> : null}
        </View>
      ) : !state.hasActivePanel ? (
        <View style={{ flex: 1, position: 'relative', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: theme.colors.text3 }}>
            {t(connectionDetail ?? (presentedConnection === 'online'
              ? '当前没有可用会话'
              : presentedConnection === 'confirming'
                ? '正在确认安全连接…'
                : presentedConnection === 'reconnecting'
                ? '正在建立安全连接…'
                : '安全连接已断开'))}
          </Text>
          {state.connection === 'offline' && pairingRequired && onPair ? (
            <PairButton label={t('重新配对')} onPress={onPair} theme={theme} />
          ) : (state.connection === 'offline' || state.connection === 'reconnecting')
            && !pairingRequired ? (
            <PairButton
              label={t('重新连接')}
              onPress={() => onIntent('reconnect')}
              status={state.connection === 'reconnecting' ? 'pending' : 'idle'}
              theme={theme}
            />
          ) : null}
          {surfaceLifecyclePresentation}
        </View>
      ) : (
        <KeyboardAvoidingView
          automaticOffset
          behavior="padding"
          keyboardVerticalOffset={0}
          style={{ flex: 1 }}
        >
          {connectionDetail ? (
            <View
              accessible
              accessibilityRole="alert"
              style={{
                minHeight: 32,
                paddingHorizontal: SPACE.x3,
                paddingVertical: SPACE.x2,
                justifyContent: 'center',
                backgroundColor: theme.colors.panel2,
                borderBottomColor: theme.colors.line,
                borderBottomWidth: 1,
              }}
            >
              <Text numberOfLines={2} style={{ color: theme.colors.warn }}>
                {t(connectionDetail)}
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1, position: 'relative' }}>
            {terminalRendererFallback && !isCollaboration ? (
              <View
                accessibilityRole="alert"
                style={{
                  minHeight: 42,
                  paddingHorizontal: SPACE.x3,
                  paddingVertical: SPACE.x2,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SPACE.x2,
                  backgroundColor: theme.colors.panel2,
                  borderBottomColor: theme.colors.line,
                  borderBottomWidth: 1,
                }}
              >
                <Text numberOfLines={2} style={{ color: theme.colors.warn, flex: 1 }}>
                  {t('当前使用兼容终端模式')}
                </Text>
                {onTerminalRendererRetry ? (
                  <MotionPressable
                    accessibilityLabel={t('恢复原生终端')}
                    accessibilityRole="button"
                    accessibilityState={{
                      busy: terminalRendererRetryPending,
                      disabled: terminalRendererRetryPending,
                    }}
                    disabled={terminalRendererRetryPending}
                    onPress={onTerminalRendererRetry}
                    style={{
                      minHeight: 34,
                      paddingHorizontal: SPACE.x2,
                      borderWidth: 1,
                      borderColor: theme.colors.line2,
                      borderRadius: RADIUS.control,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SPACE.x1,
                    }}
                  >
                    <OperationGlyph
                      idle={<RefreshCw color={theme.colors.accent} size={15} />}
                      phase={terminalRendererRetryPending ? 'pending' : 'idle'}
                      size={15}
                      theme={theme}
                    />
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '700' }}>
                      {t('恢复')}
                    </Text>
                  </MotionPressable>
                ) : null}
              </View>
            ) : null}
            {isCollaboration ? (
              <MobileRoomChat
                messages={roomMessages}
                omittedMessages={roomOmittedMessages}
                userAvatar={collaborationAvatar}
                onImagePress={onRoomImageOpen}
                theme={theme}
              />
            ) : terminalView === 'swiftterm-view' && swiftTermAvailable && nativeGridPresentation !== null ? (
              <SwiftTermGridView
                keyboardOpen={keyboardVisible || fullKeyboardOpen}
  probe={terminalProbe}
                onDismissKeyboard={() => {
                  if (fullKeyboardOpen) setInputSurface('system');
                  else void KeyboardController.dismiss();
                }}
                frame={nativeGridPresentation.frame}
                operationId={nativeGridPresentation.operationId}
                agent={activePanel?.kind === 'claude' || activePanel?.kind === 'codex' || activePanel?.kind === 'shell'
                  ? activePanel.kind : undefined}
                onMouse={onTerminalMouse}
                onPaint={routeActive ? onTerminalPaint : undefined}
                onViewport={routeActive && !keyboardVisible ? forwardTerminalResize : undefined}
                fontFamily={terminalFont}
                theme={theme}
              />
            ) : !usesByteStream && nativeGridPresentation !== null ? (
              <NativeTerminalGridView
                frame={nativeGridPresentation.frame}
                operationId={nativeGridPresentation.operationId}
                agent={activePanel?.kind === 'claude' || activePanel?.kind === 'codex' || activePanel?.kind === 'shell'
                  ? activePanel.kind : undefined}
                onMouse={onTerminalMouse}
                onPaint={routeActive ? onTerminalPaint : undefined}
                onViewport={routeActive && !keyboardVisible ? forwardTerminalResize : undefined}
                fontFamily={terminalFont}
                presentation={terminalView === 'exact-grid-view' ? 'exact-grid-view' : 'reflow-view'}
                theme={theme}
              />
            ) : state.isDemo ? (
              <TerminalFeed
                agent={state.agent}
                lines={state.lines}
                theme={theme}
              />
            ) : !usesByteStream ? (
              <View style={{ flex: 1, backgroundColor: theme.colors.panel }} />
            ) : (
              <TerminalSwapView
                agent={state.agent}
                panelId={state.activePanelId ?? 'unknown-panel'}
                onPaint={routeActive ? onTerminalPaint : undefined}
                onRecoveryNeeded={routeActive ? onTerminalRecoveryNeeded : undefined}
                onRenderStage={routeActive ? onTerminalRenderStage : undefined}
                onResize={routeActive ? forwardTerminalResize : ignoreTerminalResize}
                ref={routeActive ? terminalRef : undefined}
                theme={theme}
              />
            )}
            {/* Not over the compatibility-mode banner: its 恢复 action must stay reachable. */}
            {lastScreen !== null && !isCollaboration && !terminalRendererFallback ? (
              <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
                <LastScreenView
                  fontFamily={terminalFont}
                  screen={lastScreen}
                  terminalView={terminalView}
                  theme={theme}
                />
              </View>
            ) : null}
            {surfaceLifecyclePresentation}
          </View>
          {!interactionFrozen && !keyboardVisible && !isCollaboration && !fullKeyboardOpen ? (
            <TaskActionBar
              state={state}
              theme={theme}
              onIntent={onIntent}
            />
          ) : null}
          {terminalInputAvailable && quickKeysExpanded && !fullKeyboardOpen ? (
            <TerminalQuickKeys onInput={onTerminalInput} theme={theme} />
          ) : null}
          {fullKeyboardOpen ? (
            <View style={{ paddingBottom: Math.max(insets.bottom, SPACE.x2), backgroundColor: theme.colors.panel2 }}>
              <FullTerminalKeyboard
                onInput={onTerminalInput}
                onKey={onTerminalKey}
                onPaste={onTerminalPaste}
                shortcutBindings={terminalShortcuts}
                queueDepth={terminalQueueDepth}
                onUseSystemInput={() => setInputSurface('system')}
                theme={theme}
              />
            </View>
          ) : composerVisible ? (
            <View
              testID="composer-safe-area"
              style={{
                paddingBottom: keyboardVisible
                  ? SPACE.x1
                  : Math.max(insets.bottom, SPACE.x2),
                backgroundColor: theme.colors.panel,
              }}
            >
              <Composer
                value={state.draft}
                images={isCollaboration ? roomComposerImages : terminalComposerImages}
                imagePickPending={isCollaboration ? roomImagePickPending : terminalImagePickPending}
                mentionsEnabled={isCollaboration}
                enabled={!interactionFrozen && composerAvailable && (isCollaboration
                  ? !roomImagePickPending
                  : state.pendingIntent === null && !terminalImagePickPending)}
                operationStatus={composerSendStatus}
                theme={theme}
                onChangeText={onDraftChange}
                quickKeysAvailable={terminalInputAvailable}
                onFullKeyboard={fullKeyboardAvailable
                  ? () => {
                      if (!policy.handlesHardwareBack) void KeyboardController.dismiss();
                      setInputSurface('full-keyboard');
                    }
                  : undefined}
                onPaste={isCollaboration ? undefined : onTerminalPaste}
                quickKeysExpanded={quickKeysExpanded}
                onQuickKeysToggle={() => setQuickKeysExpanded((expanded) => !expanded)}
                onDismissKeyboard={policy.handlesHardwareBack
                  ? undefined
                  : () => { void KeyboardController.dismiss(); }}
                onFocus={isCollaboration ? undefined : onComposerFocus}
                onPickImages={isCollaboration
                  ? onRoomImagePick
                  : supportsTerminalImages ? onTerminalImagePick : undefined}
                onRemoveImage={isCollaboration ? onRoomImageRemove : onTerminalImageRemove}
                onSend={(value) => {
                  if (onDraftSubmit) onDraftSubmit(value);
                  else {
                    onDraftChange(value);
                    onIntent('send');
                  }
                }}
              />
            </View>
          ) : (
            <View
              testID="bottom-safe-area-spacer"
              style={{
                height: insets.bottom,
                backgroundColor: theme.colors.panel,
              }}
            />
          )}
        </KeyboardAvoidingView>
      )}
      <SurfaceCreateSheet
        error={surfaceCreateError ?? createPrepareError}
        initialWorkspaceCapability={activeWorkspaceCapability}
        onClose={() => {
          setCreateSheetOpen(false);
          if (createPrepareTimer.current !== null) clearTimeout(createPrepareTimer.current);
          createPrepareTimer.current = null;
          setCreateSurfacePreparing(false);
          setCreatePrepareError(null);
          onSurfaceCreateDismiss?.();
        }}
        onCreate={(workspaceCapability, kind) => {
          setPendingSurface({ workspaceCapability, kind });
          setCreateSheetOpen(false);
          onSurfaceCreate?.(workspaceCapability, kind);
        }}
        open={createSheetOpen}
        preparing={createSurfacePreparing}
        status={surfaceCreateStatus}
        theme={theme}
        workspaceLocked={onBackToProject !== undefined}
        workspaces={visibleWorkspaces}
      />
      <RoomImageViewer
        {...roomImageViewer}
        onClose={onRoomImageViewerClose ?? (() => {})}
        theme={theme}
      />
    </SafeAreaView>
  );
}

function PairButton({
  label,
  onPress,
  status = 'idle',
  theme,
}: {
  label: string;
  onPress(): void;
  status?: OperationPhase;
  theme: ConnectTheme;
}): React.ReactElement {
  const operation = operationPresentation(status);
  return (
    <MotionPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: operation.busy, disabled: operation.busy }}
      disabled={operation.busy}
      onPress={onPress}
      style={{
        minHeight: 46,
        marginTop: SPACE.x4,
        paddingHorizontal: SPACE.x4,
        borderWidth: 1,
        borderColor: theme.colors.line2,
        borderRadius: RADIUS.control,
        backgroundColor: theme.colors.bg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACE.x2,
      }}
    >
      <OperationGlyph
        idle={<ScanLine color={theme.colors.text} size={20} />}
        phase={status}
        size={20}
        theme={theme}
      />
      <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </MotionPressable>
  );
}
