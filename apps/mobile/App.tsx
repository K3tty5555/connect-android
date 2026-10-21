import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AppState,
  Settings as NativeSettings,
  StatusBar,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { useLocales } from 'expo-localization';
import * as Clipboard from 'expo-clipboard';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardEvents, KeyboardProvider } from 'react-native-keyboard-controller';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  acceptsOwnershipUpdate,
  reduceSession,
  collaborationProfileWorkspace,
  ownershipEventDisposition,
  appStateReopen,
  autoTakeoverArmSpent,
  shouldAutoTakeover,
  shouldCarryMobileControl,
  resolvePanelSelection,
  shouldTakeoverCreatedTerminal,
  type MobileIntent,
  type OwnershipIntent,
  type SessionPanelSummary,
  type SurfaceKind,
} from './src/domain/session';
import {
  CreatedTerminalReconciler,
  matchUniqueNewSurface,
} from './src/domain/createdTerminalReconciler';
import { runRecoveryRefresh } from './src/domain/recoveryRefresh';
import {
  BackgroundConnectionCoordinator,
  shouldBackgroundMobileConnection,
} from './src/domain/backgroundConnectionCoordinator';
import {
  ownershipReconcileDelayMs,
  OwnershipReconciler,
} from './src/domain/ownershipReconciler';
import {
  isRecoverableOwnershipError,
  ownershipReplyMatches,
  OwnershipConfirmationTimers,
} from './src/domain/ownershipConfirmation';
import { TerminalDraftSubmission } from './src/domain/terminalDraftSubmission';
import { TerminalWriteConfirmation } from './src/domain/terminalWriteConfirmation';
import { TerminalInputQueue } from './src/domain/terminalInputQueue';
import { LocalUnpairCoordinator } from './src/domain/localUnpair';
import {
  createPendingRoomMessage,
  mergeBoundedRoomMessages,
  removeRoomMessage,
} from './src/domain/roomMessages';
import {
  demoRunningSession,
  unpairedSession,
} from './src/fixtures/sessionFixtures';
import { SessionScreen } from './src/screens/SessionScreen';
import { DeviceIdentityStore, IdentityAccessError } from './src/net/deviceIdentity';
import { PairedDesktopStore } from './src/net/pairedDesktop';
import {
  BridgeClient,
  MobileConnectionUnstableError,
  createMobileRequestId,
  type MobileRoomMessage,
  type PairedDesktopProfile,
} from './src/net/bridgeClient';
import { MobileConnectFailureError } from './src/net/mobileConnectFailure';
import { relayTicketForDevice } from './src/net/relayTransport';
import { PairingClient } from './src/pairing/pairingClient';
import { PairingFlow } from './src/pairing/PairingFlow';
import {
  initialMobileNavigation,
  reduceMobileNavigation,
  shouldRefreshSessionTerminal,
  type MobileNavigationSnapshot,
  type MobileRoute,
  type RouteEvent,
} from './src/navigation/routes';
import {
  describeMobileResumeTarget,
  MobileResumeStore,
  resolveMobileRouteRevalidation,
  resolveMobileResumeTarget,
  shouldApplyMobileResumeTarget,
  type MobileResumeTarget,
} from './src/navigation/resumeStore';
import {
  presentMobileRouteCatalog,
  type MobileRouteCatalogSnapshot,
} from './src/navigation/catalogPresentation';
import { HomeScreen } from './src/screens/HomeScreen';
import { ProjectScreen } from './src/screens/ProjectScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { MOBILE_PUBLIC_APP_INFO, openMobilePublicLink } from './src/publicAppInfo';
import { RouteTransitionView } from './src/components/RouteTransitionView';
import { usePresentedConnection } from './src/components/usePresentedConnection';
import { ReducedMotionProvider } from './src/theme/reducedMotion';
import { themeFor } from './src/theme/theme';
import {
  DEFAULT_MOBILE_PREFERENCES,
} from './src/settings/preferencesContract';
import {
  MobilePreferencesStore,
  type MobilePreferencesPatch,
} from './src/settings/preferencesStore';
import type {
  MobilePanelStatus,
  MobilePreferences,
  TerminalGridFrame,
} from '../../src/shared/types';
import type { TerminalKeyModifiers, TerminalKeyName } from '../../src/shared/terminalInput';
import {
  MobilePerformanceTrace,
  type MobilePerformanceOperation,
} from './src/performance/mobilePerformanceTrace';
import { createExpoMobilePerformanceStore } from './src/performance/expoMobilePerformanceStore';
import type { TerminalStreamHandle } from './src/terminal/terminalStreamHandle';
import { shouldMarkPanelRead } from './src/domain/panelRead';
import {
  TERMINAL_OPENING_SETTLE_MS,
  expectsPhoneGeometry,
  terminalOpeningSettled,
} from './src/terminal/terminalOpeningSettle';
import { TerminalGeometryGuard } from './src/terminal/terminalGeometryGuard';
import { TerminalTranscriptCache } from './src/terminal/terminalTranscriptCache';
import { TerminalRecoveryCoordinator } from './src/terminal/terminalRecoveryCoordinator';
import { TerminalPaintDeadline } from './src/terminal/terminalPaintDeadline';
import { TerminalPayloadRejectionPolicy } from './src/terminal/terminalPayloadRejection';
import { TerminalSwapCoordinator } from './src/terminal/terminalSwapCoordinator';
import {
  TerminalGridStore,
  type NativeTerminalGridState,
} from './src/terminal/terminalGridModel';
import { terminalGridFrameDisposition } from './src/terminal/terminalGridPresentation';
import {
  deliverTerminalHistory,
  deliverTerminalOutput,
  deliverTerminalSnapshot,
} from './src/terminal/terminalOutputRouter';
import {
  TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE,
  terminalSnapshotFailureDetail,
} from './src/terminal/terminalSnapshotFailure';
import {
  RoomImageCommitAmbiguousError,
  RoomImageTransferCoordinator,
  type PreparedRoomImage,
} from './src/domain/roomImageTransfer';
import {
  cleanupPreparedRoomImages,
  digestRoomImage,
  pickRoomImages,
  pickTerminalImage,
} from './src/domain/roomImagePicker';
import {
  TerminalImageCommitAmbiguousError,
  TerminalImageTransferCoordinator,
} from './src/domain/terminalImageTransfer';
import { WorkspaceFilesUnsupportedError, WorkspaceFileTransport } from './src/domain/workspaceFiles';
import { WorkspaceFileViewer } from './src/components/files/WorkspaceFileViewer';
import {
  pruneWorkspaceFileTreeStores,
  workspaceFileTreeStore,
} from './src/components/files/WorkspaceFilesPane';
import {
  createStoreShotFileDesktop,
  STORE_SHOT_EXPANDED_DIRS,
  STORE_SHOT_OPEN_FILE,
} from './src/fixtures/storeShotFiles';
import { SurfaceCreateSheet } from './src/components/SurfaceCreateSheet';
import { TabletSidebar, type TabletSidebarMode } from './src/tablet/TabletSidebar';
import {
  TabletTabStrip,
  tabletFileTabKey,
  type TabletFileTab,
} from './src/tablet/TabletTabStrip';
import { TabletContentArea } from './src/tablet/TabletContentArea';
import { TabletEmptyState } from './src/tablet/TabletEmptyState';
import {
  isTabletLayout,
  remapTabletFileTabs,
  tabletSidebarWidth,
} from './src/tablet/tabletLayout';
import { SafeAreaView } from 'react-native-safe-area-context';
import { pickCollaborationAvatar } from './src/domain/collaborationAvatarPicker';
import { operationPresentation, type OperationPhase } from './src/domain/operationPresentation';
import { createPtyGeometryHandover } from './src/terminal/terminalGeometryHandover';
import {
  LastScreenStore,
  desktopKeyOf,
  lastScreenFromGrid,
  lastScreenFromTranscript,
  type LastScreen,
} from './src/terminal/lastScreenStore';
import { createExpoLastScreenFile } from './src/terminal/expoLastScreenFile';
import { ResumePreviewScreen } from './src/screens/ResumePreviewScreen';
import { resumePreviewScreen, sessionLastScreen } from './src/terminal/lastScreenPresentation';
import { useOperationState } from './src/domain/useOperationState';
import { adjacentPanelAfterClose } from './src/domain/surfaceLifecycle';
import { configureI18n, t } from './src/i18n';
import { playInteractionFeedback } from './src/theme/interactionFeedback';
import {
  NATIVE_TERMINAL_GRID_FIXTURE,
  NATIVE_TERMINAL_GRID_HISTORY_FIXTURE,
  swiftTermSequenceFixture,
} from './src/fixtures/nativeTerminalGridFixture';
import { STORE_SHOT } from './src/storeShot';
import {
  STORE_SHOT_ROOM,
  STORE_SHOT_SAS,
  STORE_SHOT_WORKSPACE,
  storeShotRoomMessages,
  storeShotSession,
  storeShotTerminalFrame,
} from './src/fixtures/storeShotFixtures';

/** Builds that never pair or connect: the demo fixture, or the App Store screenshot scenes. */
const DEMO_BUILD = process.env.EXPO_PUBLIC_CONNECT_DEMO === '1' || STORE_SHOT !== null;
const INITIAL = STORE_SHOT !== null
  ? storeShotSession(STORE_SHOT)
  : process.env.EXPO_PUBLIC_CONNECT_DEMO === '1'
  || process.env.EXPO_PUBLIC_CONNECT_NATIVE_GRID_DEMO === '1'
  ? demoRunningSession
  : unpairedSession;
const NATIVE_GRID_DEMO = process.env.EXPO_PUBLIC_CONNECT_NATIVE_GRID_DEMO === '1';
const NATIVE_GRID_DEMO_ROUTE = NATIVE_GRID_DEMO
  ? NativeSettings.get('ConnectNativeGridRoute')
  : null;
// seq-* 夹具按真实桥的到达顺序分两帧：先只有视口，随后带长历史（MOBILE-CHAT-NOT-AT-LATEST-1012）。
const NATIVE_GRID_DEMO_SEQUENCE = NATIVE_GRID_DEMO
  ? swiftTermSequenceFixture(String(NativeSettings.get('ConnectNativeGridFixture') ?? ''))
  : null;
const NATIVE_GRID_DEMO_FRAME = NATIVE_GRID_DEMO_SEQUENCE?.[0] ?? (NATIVE_GRID_DEMO
  && NativeSettings.get('ConnectNativeGridFixture') === 'history'
  ? NATIVE_TERMINAL_GRID_HISTORY_FIXTURE
  : NATIVE_TERMINAL_GRID_FIXTURE);
function storeShotRoute(): MobileRoute {
  switch (STORE_SHOT?.scene) {
    case 'terminal':
      return { kind: 'session', workspaceCapability: STORE_SHOT_WORKSPACE, panelId: INITIAL.activePanelId! };
    case 'room':
      return { kind: 'session', workspaceCapability: STORE_SHOT_WORKSPACE, panelId: STORE_SHOT_ROOM };
    case 'sessions':
    case 'create':
    case 'files':
      return { kind: 'project', workspaceCapability: STORE_SHOT_WORKSPACE };
    default:
      return { kind: 'root', tab: 'home' };
  }
}
/** Trailing debounce: rotation and layout churn must not become a SIGWINCH storm. */
const PTY_GEOMETRY_SETTLE_MS = 300;
/** How often a terminal on screen refreshes its saved last screen. */
const LAST_SCREEN_SAVE_INTERVAL_MS = 15_000;

const OWNERSHIP_CONFIRM_TIMEOUT_MS = 8_000;
const REFRESH_CONFIRM_TIMEOUT_MS = 10_000;
type RefreshPart = 'workspaces' | 'panels' | 'rooms';

export default function App(): React.ReactElement {
  const locales = useLocales();
  const [state, dispatch] = useReducer(reduceSession, INITIAL);
  const presentedConnection = usePresentedConnection(state.connection);
  const [pairingOpen, setPairingOpen] = useState(STORE_SHOT?.scene === 'pair');
  const [pairingRequired, setPairingRequired] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const surfaceCreateOperation = useOperationState();
  const [surfaceCreateError, setSurfaceCreateError] = useState<string | null>(null);
  const surfaceCloseOperation = useOperationState();
  const composerSendOperation = useOperationState();
  const refreshOperation = useOperationState();
  const surfaceCreateStatus = surfaceCreateOperation.snapshot.phase;
  const surfaceCloseStatus = surfaceCloseOperation.snapshot.phase;
  const composerSendStatus = composerSendOperation.snapshot.phase;
  const refreshStatus = refreshOperation.snapshot.phase;
  const [terminalSwapStatus, setTerminalSwapStatus] = useState<OperationPhase>('idle');
  const [terminalQueueDepth, setTerminalQueueDepth] = useState(0);
  const surfaceClosePending = operationPresentation(surfaceCloseStatus).busy;
  const composerSendPending = operationPresentation(composerSendStatus).busy;
  const [navigation, setNavigation] = useState<MobileNavigationSnapshot>(() => (
    STORE_SHOT !== null
      ? { generation: 0, route: storeShotRoute(), transition: 'none' }
      : NATIVE_GRID_DEMO_ROUTE === 'settings'
      ? {
          generation: 0,
          route: { kind: 'root', tab: 'settings' },
          transition: 'none',
        }
      : NATIVE_GRID_DEMO
      ? {
          generation: 0,
          route: {
            kind: 'session',
            workspaceCapability: demoRunningSession.workspaces[0]!.workspaceCapability,
            panelId: demoRunningSession.activePanelId!,
          },
          transition: 'none',
        }
      : initialMobileNavigation
  ));
  const route = navigation.route;
  const [catalogReady, setCatalogReady] = useState(STORE_SHOT !== null);
  /**
   * The desktop's lamp per panel (MOBILE-SESSION-RUN-STATE-01). Empty until a
   * desktop that offers it answers, and cleared off-line: an old colour must
   * not pass for the current one.
   */
  const [panelStatuses, setPanelStatuses] = useState<Readonly<Record<string, MobilePanelStatus>>>({});
  const [resumeTarget, setResumeTarget] = useState<MobileResumeTarget | null>(null);
  const [resumeLoaded, setResumeLoaded] = useState(false);
  const [preferences, setPreferences] = useState<MobilePreferences>({
    ...DEFAULT_MOBILE_PREFERENCES,
    notifications: { ...DEFAULT_MOBILE_PREFERENCES.notifications },
  });
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesPending, setPreferencesPending] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [terminalRendererFallback, setTerminalRendererFallback] = useState(false);
  const [terminalRendererRetryPending, setTerminalRendererRetryPending] = useState(false);
  const terminalRendererRetryGenerationRef = useRef(0);
  // The phone draws terminals only with the native view — SwiftTerm on iOS,
  // Termux on Android (user decision 2026-10-17, MOBILE-NATIVE-RENDERER-ONLY-01).
  // The stored `terminalView` preference is kept for data compatibility only.
  // Grid frames are the normal transport; the byte stream is the compatibility
  // fallback, and the same native view draws it.
  const configuredTerminalRenderer = 'native-grid' as const;
  const effectiveTerminalView = 'swiftterm-view' as const;
  const effectiveTerminalRenderer = terminalRendererRetryPending
    ? 'native-grid' as const
    : terminalRendererFallback
    ? 'legacy-webview' as const
    : configuredTerminalRenderer;
  const terminalRendererRef = useRef(effectiveTerminalRenderer);
  terminalRendererRef.current = effectiveTerminalRenderer;
  const [unpairPending, setUnpairPending] = useState(false);
  const [unpairError, setUnpairError] = useState<string | null>(null);
  const [collaborationAvatar, setCollaborationAvatar] = useState<string | null>(null);
  const [collaborationAvatarPending, setCollaborationAvatarPending] = useState(false);
  const [collaborationAvatarError, setCollaborationAvatarError] = useState<string | null>(null);
  const [roomView, setRoomView] = useState<{
    roomCapability: string | null;
    messages: MobileRoomMessage[];
    omittedMessages: number;
  }>(STORE_SHOT?.scene === 'room'
    ? { roomCapability: STORE_SHOT_ROOM, messages: storeShotRoomMessages(STORE_SHOT.locale), omittedMessages: 0 }
    : { roomCapability: null, messages: [], omittedMessages: 0 });
  const [roomComposerImages, setRoomComposerImages] = useState<{
    roomCapability: string | null;
    images: PreparedRoomImage[];
  }>({ roomCapability: null, images: [] });
  const [roomImagePickPending, setRoomImagePickPending] = useState(false);
  const [terminalComposerImage, setTerminalComposerImage] = useState<{
    panelId: string | null;
    image: PreparedRoomImage | null;
  }>({ panelId: null, image: null });
  const [terminalImagePickPending, setTerminalImagePickPending] = useState(false);
  const [roomImageViewer, setRoomImageViewer] = useState<{
    open: boolean;
    uri: string | null;
    pending: boolean;
    error: string | null;
  }>({ open: false, uri: null, pending: false, error: null });
  const systemColorScheme = useColorScheme();
  configureI18n(preferences.language, locales[0]?.languageTag);
  const theme = themeFor(systemColorScheme, preferences.theme);
  const stateRef = useRef(state);
  const ptyGeometryRef = useRef<ReturnType<typeof createPtyGeometryHandover> | null>(null);
  // The last terminal screen kept on the phone (see lastScreenStore). Shown on a
  // cold start until the first live paint, then never again this run.
  const [lastScreenStore] = useState(() => new LastScreenStore(
    DEMO_BUILD
      ? { read: () => null, write: () => {}, remove: () => {} }
      : createExpoLastScreenFile(),
  ));
  const [lastScreen, setLastScreen] = useState<LastScreen | null>(() => lastScreenStore.load());
  const [lastScreenRetired, setLastScreenRetired] = useState(false);
  /** The panel an exact cold-start resume landed on: the only one the saved screen may cover. */
  const [resumedPanelId, setResumedPanelId] = useState<string | null>(null);
  const [desktopKey, setDesktopKey] = useState<string | null>(null);
  const [relayProfile, setRelayProfile] = useState<PairedDesktopProfile['relay'] | null>(null);
  const desktopKeyRef = useRef<string | null>(null);
  desktopKeyRef.current = desktopKey;
  const navigationRef = useRef(navigation);
  const routeRef = useRef(route);
  const routeCatalogSnapshotRef = useRef<MobileRouteCatalogSnapshot | null>(null);
  const preferencesWriteCountRef = useRef(0);
  const pendingSurfaceCreateRef = useRef<{
    requestId: string;
    workspaceCapability: string;
    surfaceKind: SurfaceKind;
    existingPanelIds: Set<string>;
  } | null>(null);
  const terminalPanelsRef = useRef<SessionPanelSummary[]>([]);
  const roomPanelsRef = useRef<SessionPanelSummary[]>([]);
  const roomCacheRef = useRef(new Map<string, {
    messages: MobileRoomMessage[];
    omittedMessages: number;
  }>());
  const pendingRoomSendRef = useRef<{
    requestId: string;
    roomCapability: string;
    text: string;
    localMessageId: string;
  } | null>(null);
  const roomSendAmbiguousRef = useRef(false);
  const collaborationProfileCapabilityRef = useRef<string | null>(null);
  const collaborationProfileRequestRef = useRef<{
    requestId: string;
    workspaceCapability: string;
  } | null>(null);
  const collaborationProfileRetriedRef = useRef(false);
  const collaborationAvatarOperationRef = useRef<{
    requestId: string | null;
    workspaceCapability: string;
  } | null>(null);
  const terminalWriteAmbiguousRef = useRef(false);
  const performanceTraceRef = useRef<MobilePerformanceTrace | null>(null);
  const performanceStoreRef = useRef<ReturnType<typeof createExpoMobilePerformanceStore> | null>(null);
  performanceStoreRef.current ??= createExpoMobilePerformanceStore();
  performanceTraceRef.current ??= new MobilePerformanceTrace(
    512,
    () => performance.now(),
    (mark) => performanceStoreRef.current?.record(mark),
  );
  const performanceTrace = performanceTraceRef.current;
  const pendingNavigationRef = useRef<string | null>(null);
  const pendingNavigationRelatedRef = useRef<MobilePerformanceOperation[]>([]);
  const completedNavigationRef = useRef<string | null>(null);
  const appStartOperationRef = useRef<{
    operationId: string;
    completed: boolean;
    stable: boolean;
  } | null>(null);
  if (appStartOperationRef.current === null) {
    const operationId = createMobileRequestId();
    appStartOperationRef.current = { operationId, completed: false, stable: false };
    performanceTrace.record(operationId, 'app_start', 'started');
    performanceTrace.record(operationId, 'app_start', 'local_feedback');
    performanceTrace.record(operationId, 'app_start', 'intent_committed');
  }
  const pendingTerminalRenderRef = useRef<{
    requestId: string;
    panelId: string;
    ptyObserved: boolean;
  } | null>(null);
  const resumeAppliedRef = useRef(false);
  // Mirrors the ref for rendering: the resume preview must leave the screen the
  // moment the resume is applied or abandoned, not on some later re-render.
  const [resumeSettled, setResumeSettled] = useState(false);
  const settleResume = (): void => {
    resumeAppliedRef.current = true;
    setResumeSettled(true);
  };
  const resumeLoadedRef = useRef(resumeLoaded);
  resumeLoadedRef.current = resumeLoaded;
  const resumeTargetRef = useRef<MobileResumeTarget | null>(null);
  const createdRoomRef = useRef<{
    requestId: string;
    workspaceCapability: string;
    existingRoomCapabilities: Set<string>;
  } | null>(null);
  const createdTerminalRef = useRef<{
    requestId: string;
    workspaceCapability: string;
    kind: Exclude<SurfaceKind, 'collaboration'>;
    existingPanelIds: Set<string>;
  } | null>(null);
  const createdTerminalReconcilerRef = useRef<CreatedTerminalReconciler | null>(null);
  createdTerminalReconcilerRef.current ??= new CreatedTerminalReconciler();
  const createdTerminalReconciler = createdTerminalReconcilerRef.current;
  const createdRoomReconcilerRef = useRef<CreatedTerminalReconciler | null>(null);
  createdRoomReconcilerRef.current ??= new CreatedTerminalReconciler();
  const createdRoomReconciler = createdRoomReconcilerRef.current;
  const ownershipReconcilerRef = useRef<OwnershipReconciler | null>(null);
  ownershipReconcilerRef.current ??= new OwnershipReconciler();
  const ownershipReconciler = ownershipReconcilerRef.current;
  const closedTerminalRef = useRef<string | null>(null);
  const closedPanelIdsRef = useRef(new Set<string>());
  const closedTerminalReconcilerRef = useRef<CreatedTerminalReconciler | null>(null);
  closedTerminalReconcilerRef.current ??= new CreatedTerminalReconciler();
  const closedTerminalReconciler = closedTerminalReconcilerRef.current;
  const pendingSurfaceCloseRef = useRef<{
    requestId: string;
    panelId: string;
    epoch: number;
  } | null>(null);
  const bridge = useRef<BridgeClient | null>(null);
  const ownershipRequestRef = useRef<{
    intent: OwnershipIntent;
    origin: 'user' | 'automatic';
    requestId: string;
    panelId: string;
  } | null>(null);
  const terminalDraftSubmissionRef = useRef<TerminalDraftSubmission | null>(null);
  terminalDraftSubmissionRef.current ??= new TerminalDraftSubmission();
  const terminalDraftSubmission = terminalDraftSubmissionRef.current;
  const terminalWriteConfirmationRef = useRef<TerminalWriteConfirmation | null>(null);
  terminalWriteConfirmationRef.current ??= new TerminalWriteConfirmation();
  const terminalWriteConfirmation = terminalWriteConfirmationRef.current;
  const terminalInputQueueRef = useRef<TerminalInputQueue | null>(null);
  terminalInputQueueRef.current ??= new TerminalInputQueue((panelId, depth) => {
    if (stateRef.current.activePanelId === panelId) setTerminalQueueDepth(depth);
  });
  const terminalInputQueue = terminalInputQueueRef.current;
  if (state.activePanelId !== null) {
    terminalDraftSubmission.update(state.activePanelId, state.draft);
  }
  const ownershipConfirmationTimersRef = useRef<OwnershipConfirmationTimers | null>(null);
  ownershipConfirmationTimersRef.current ??= new OwnershipConfirmationTimers();
  const ownershipConfirmationTimers = ownershipConfirmationTimersRef.current;
  const refreshRef = useRef<{
    requestId: string;
    pending: Set<RefreshPart>;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const carryControlTargetRef = useRef<string | null>(null);
  const terminalRef = useRef<TerminalStreamHandle>(null);
  const terminalSwapRef = useRef<TerminalSwapCoordinator | null>(null);
  terminalSwapRef.current ??= new TerminalSwapCoordinator();
  const terminalSwap = terminalSwapRef.current;
  const terminalGridStoreRef = useRef<TerminalGridStore | null>(null);
  terminalGridStoreRef.current ??= new TerminalGridStore();
  const terminalGridStore = terminalGridStoreRef.current;
  const [nativeGridPresentation, setNativeGridPresentation] = useState<{
    frame: NativeTerminalGridState;
    operationId?: string;
  } | null>(STORE_SHOT?.scene === 'terminal'
    ? { frame: storeShotTerminalFrame(STORE_SHOT.locale) }
    : NATIVE_GRID_DEMO ? { frame: NATIVE_GRID_DEMO_FRAME } : null);
  useEffect(() => {
    if (!NATIVE_GRID_DEMO_SEQUENCE) return;
    const timer = setTimeout(() => setNativeGridPresentation({ frame: NATIVE_GRID_DEMO_SEQUENCE[1]! }), 1500);
    return () => clearTimeout(timer);
  }, []);
  const attachedPanelIdRef = useRef<string | null>(null);
  const terminalTranscriptsRef = useRef<TerminalTranscriptCache | null>(null);
  terminalTranscriptsRef.current ??= new TerminalTranscriptCache();
  const terminalTranscripts = terminalTranscriptsRef.current;
  const terminalGeometryGuardRef = useRef<TerminalGeometryGuard | null>(null);
  terminalGeometryGuardRef.current ??= new TerminalGeometryGuard();
  const terminalGeometryGuard = terminalGeometryGuardRef.current;
  const payloadRejectionRef = useRef<TerminalPayloadRejectionPolicy | null>(null);
  payloadRejectionRef.current ??= new TerminalPayloadRejectionPolicy();
  const payloadRejection = payloadRejectionRef.current;
  const terminalRecoveryRef = useRef<TerminalRecoveryCoordinator | null>(null);
  terminalRecoveryRef.current ??= new TerminalRecoveryCoordinator();
  const terminalRecovery = terminalRecoveryRef.current;
  // Declared ahead of `failTerminalSwap` so the deadline can reach the current
  // closure without being rebuilt on every render.
  const failTerminalSwapRef = useRef<((panelId: string, operationId?: string) => void) | null>(null);
  const paintDeadlineRef = useRef<TerminalPaintDeadline | null>(null);
  paintDeadlineRef.current ??= new TerminalPaintDeadline({
    onExpired: (panelId, operationId) => {
      performanceTrace.record(operationId, 'terminal_render', 'failed', 'retryable');
      failTerminalSwapRef.current?.(panelId, operationId);
    },
  });
  const paintDeadline = paintDeadlineRef.current;
  const syncTerminalSwapStatus = (): void => {
    const snapshot = terminalSwap.snapshot();
    setTerminalSwapStatus(
      snapshot.phase === 'preparing' || snapshot.phase === 'painting'
        ? 'pending'
        : snapshot.phase === 'failed' ? 'failed' : 'idle',
    );
    paintDeadline.sync(snapshot);
  };
  const beginTerminalSwap = (
    panelId: string,
    operationId: string,
    force = false,
  ): ReturnType<TerminalSwapCoordinator['begin']> => {
    const nativeRenderer = terminalRendererRef.current === 'native-grid';
    const nativeSnapshot = terminalGridStore.get(panelId);
    const snapshot = terminalTranscripts.snapshot(panelId);
    const terminal = terminalRef.current;
    const result = terminalSwap.begin(
      panelId,
      operationId,
      nativeRenderer ? nativeSnapshot !== null : snapshot !== null && terminal !== null,
      force,
    );
    if (result.kind === 'restored' && result.canceledOperationId !== null) {
      terminal?.cancelReplacement(result.canceledOperationId);
    }
    if (result.kind === 'painting' && nativeRenderer && nativeSnapshot !== null) {
      setNativeGridPresentation({ frame: nativeSnapshot, operationId: result.operationId });
    } else if (result.kind === 'painting' && snapshot !== null && terminal !== null) {
      terminal.replace(snapshot.segments, {
        trimmedLines: snapshot.trimmedLines,
        lostLines: snapshot.lostLines,
        partialLoss: snapshot.partialLoss,
      }, result.operationId);
    }
    syncTerminalSwapStatus();
    return result;
  };
  const presentPreparedTerminalFrame = (
    panelId: string,
    fallbackSegments: Parameters<TerminalStreamHandle['replace']>[0] = [],
    fallbackRestore: Parameters<TerminalStreamHandle['replace']>[1] = {},
  ): boolean => {
    const terminal = terminalRef.current;
    if (terminal === null) return false;
    const operationId = terminalSwap.frameReady(panelId);
    if (operationId === null) return false;
    const snapshot = terminalTranscripts.snapshot(panelId);
    terminal.replace(
      snapshot?.segments ?? fallbackSegments,
      snapshot === null ? fallbackRestore : {
        trimmedLines: snapshot.trimmedLines,
        lostLines: snapshot.lostLines,
        partialLoss: snapshot.partialLoss,
      },
      operationId,
    );
    // The compatibility renderer never receives a grid frame, so this is the
    // only place a panel on that path can prove it is presentable again.
    payloadRejection.clear(panelId);
    syncTerminalSwapStatus();
    return true;
  };
  const failTerminalSwap = (panelId: string, operationId?: string): void => {
    const pendingOperationId = terminalSwap.snapshot().operationId;
    if (!terminalSwap.fail(panelId, operationId)) return;
    // No live frame is coming for now; an old picture must not stand in for it.
    setLastScreenRetired(true);
    if (pendingOperationId !== null) {
      terminalRef.current?.cancelReplacement(pendingOperationId);
    }
    syncTerminalSwapStatus();
  };
  /**
   * Drops this panel to the compatibility renderer — the same landing the
   * desktop's own `terminal_grid_unavailable` uses, so there is one fallback
   * path rather than two that can drift apart.
   */
  const fallBackToCompatibilityRenderer = (panelId: string | null): void => {
    setTerminalRendererRetryPending(false);
    setTerminalRendererFallback(true);
    terminalRendererRef.current = 'legacy-webview';
    bridge.current?.setTerminalRenderer('legacy-webview');
    if (panelId !== null) {
      attachedPanelIdRef.current = null;
      const operationId = createMobileRequestId();
      beginTerminalSwap(panelId, operationId, true);
      void bridge.current?.attach(
        panelId,
        true,
        operationId,
        'legacy-webview',
      ).catch(() => {
        failTerminalSwap(panelId, operationId);
        setBridgeError('原生终端不可用，兼容模式恢复失败，请刷新重试。');
      });
    }
    setBridgeError('原生终端暂不可用，已切换到兼容模式。');
  };
  failTerminalSwapRef.current = failTerminalSwap;
  const forgetPairingRef = useRef<((message: string | null) => Promise<void>) | null>(null);
  const roomComposerImagesRef = useRef(roomComposerImages);
  const terminalComposerImageRef = useRef(terminalComposerImage);
  const roomImageViewerRequestRef = useRef(0);
  const roomImagePickRequestRef = useRef(0);
  const terminalImagePickRequestRef = useRef(0);
  stateRef.current = state;
  navigationRef.current = navigation;
  routeRef.current = route;
  roomComposerImagesRef.current = roomComposerImages;
  terminalComposerImageRef.current = terminalComposerImage;
  const publishSessionPanels = (): void => {
    const panels = [...terminalPanelsRef.current, ...roomPanelsRef.current];
    const selected = panels.find(
      (panel) => panel.panelId === stateRef.current.activePanelId,
    ) ?? panels[0] ?? null;
    dispatch({
      type: 'panels_changed',
      panels,
      selectedDraft: selected === null
        ? ''
        : terminalDraftSubmission.currentDraft(selected.panelId),
    });
  };
  const showRoom = (roomCapability: string): void => {
    const cached = roomCacheRef.current.get(roomCapability);
    setRoomView({
      roomCapability,
      messages: cached?.messages ?? [],
      omittedMessages: cached?.omittedMessages ?? 0,
    });
  };
  const storeRoom = (
    roomCapability: string,
    messages: MobileRoomMessage[],
    omittedMessages: number,
  ): void => {
    const snapshot = { messages, omittedMessages };
    roomCacheRef.current.set(roomCapability, snapshot);
    if (stateRef.current.activePanelId === roomCapability) {
      setRoomView({ roomCapability, ...snapshot });
    }
  };
  const clearPendingRoomMessage = (pending: NonNullable<typeof pendingRoomSendRef.current>): void => {
    const cached = roomCacheRef.current.get(pending.roomCapability);
    if (cached === undefined) return;
    storeRoom(
      pending.roomCapability,
      removeRoomMessage(cached.messages, pending.localMessageId),
      cached.omittedMessages,
    );
  };
  const identityRef = useRef<DeviceIdentityStore | null>(null);
  const profileStoreRef = useRef<PairedDesktopStore | null>(null);
  const preferencesStoreRef = useRef<MobilePreferencesStore | null>(null);
  const resumeStoreRef = useRef<MobileResumeStore | null>(null);
  const localUnpairCoordinatorRef = useRef<LocalUnpairCoordinator | null>(null);
  identityRef.current ??= new DeviceIdentityStore();
  profileStoreRef.current ??= new PairedDesktopStore();
  preferencesStoreRef.current ??= new MobilePreferencesStore();
  resumeStoreRef.current ??= new MobileResumeStore();
  localUnpairCoordinatorRef.current ??= new LocalUnpairCoordinator();
  const identity = identityRef.current;
  const profileStore = profileStoreRef.current;
  const preferencesStore = preferencesStoreRef.current;
  const resumeStore = resumeStoreRef.current;
  const localUnpairCoordinator = localUnpairCoordinatorRef.current;
  const clearOwnershipConfirmTimer = (): void => {
    ownershipConfirmationTimers.stop();
  };
  const clearRefresh = (
    phase: Extract<OperationPhase, 'idle' | 'completed' | 'failed' | 'ambiguous'>,
    requestId?: string,
  ): void => {
    const pending = refreshRef.current;
    if (pending !== null) clearTimeout(pending.timer);
    refreshRef.current = null;
    if (phase === 'idle') {
      refreshOperation.cancel(requestId);
      return;
    }
    const correlatedId = requestId ?? pending?.requestId;
    if (correlatedId !== undefined) refreshOperation.advance(correlatedId, phase);
  };
  const acceptRefreshPart = (requestId: string | undefined, part: RefreshPart): void => {
    const pending = refreshRef.current;
    if (pending === null || requestId !== pending.requestId) return;
    pending.pending.delete(part);
    if (pending.pending.size === 0) {
      clearRefresh('completed', requestId);
      setBridgeError(null);
    }
  };
  const failOwnershipRequest = (
    intent: OwnershipIntent,
    requestId: string,
    message: string,
  ): void => {
    if (
      ownershipRequestRef.current?.intent !== intent
      || ownershipRequestRef.current.requestId !== requestId
    ) return;
    clearOwnershipConfirmTimer();
    ownershipRequestRef.current = null;
    carryControlTargetRef.current = null;
    performanceTrace.record(requestId, 'ownership', 'failed', 'ambiguous');
    setBridgeError(message);
    dispatch({ type: 'intent_failed', intent, category: 'ambiguous' });
  };
  const beginOwnershipRequest = (
    intent: OwnershipIntent,
    panelId: string,
    origin: 'user' | 'automatic',
  ): string => {
    clearOwnershipConfirmTimer();
    const requestId = createMobileRequestId();
    performanceTrace.record(requestId, 'ownership', 'started');
    performanceTrace.record(requestId, 'ownership', 'local_feedback');
    performanceTrace.record(requestId, 'ownership', 'intent_committed');
    ownershipRequestRef.current = { intent, origin, requestId, panelId };
    dispatch({ type: 'intent_requested', intent });
    ownershipConfirmationTimers.start({
      hedgeDelayMs: ownershipReconcileDelayMs(bridge.current?.roundTripEstimateMs() ?? null),
      timeoutMs: OWNERSHIP_CONFIRM_TIMEOUT_MS,
      onHedge: () => {
        const pending = ownershipRequestRef.current;
        if (
          pending?.requestId !== requestId
          || pending.panelId !== panelId
          || stateRef.current.connection !== 'online'
        ) return;
        void bridge.current?.queryOwnership(panelId, requestId).catch(() => {});
      },
      onTimeout: () => {
        failOwnershipRequest(intent, requestId, '控制权确认超时，请检查连接后重试。');
      },
    });
    return requestId;
  };
  /** A takeover the App starts on the user's behalf: carrying control, or opening a terminal. */
  const requestAutomaticTakeover = (panelId: string, failure: string): void => {
    if (ownershipRequestRef.current !== null) return;
    const requestId = beginOwnershipRequest('takeover', panelId, 'automatic');
    const currentBridge = bridge.current;
    if (currentBridge === null) {
      failOwnershipRequest('takeover', requestId, failure);
      return;
    }
    void currentBridge.send({ kind: 'takeover', requestId, panelId }).catch(() => {
      failOwnershipRequest('takeover', requestId, failure);
    });
  };
  const commitNavigation = (next: MobileNavigationSnapshot): void => {
    navigationRef.current = next;
    routeRef.current = next.route;
    setNavigation(next);
  };
  const commitRouteEvent = (event: RouteEvent): boolean => {
    const current = navigationRef.current;
    const next = reduceMobileNavigation(current, event);
    if (next === current) return false;
    commitNavigation(next);
    return true;
  };
  const navigate = (
    event: RouteEvent,
    related: readonly Extract<MobilePerformanceOperation, 'workspace_switch' | 'terminal_switch'>[] = [],
  ): void => {
    const current = navigationRef.current;
    const next = reduceMobileNavigation(current, event);
    if (next === current) return;
    const previousOperationId = pendingNavigationRef.current;
    if (previousOperationId !== null) {
      performanceTrace.record(previousOperationId, 'navigation', 'cancelled');
      for (const operation of pendingNavigationRelatedRef.current) {
        performanceTrace.record(previousOperationId, operation, 'cancelled');
      }
    }
    const operationId = createMobileRequestId();
    performanceTrace.record(operationId, 'navigation', 'started');
    for (const operation of related) performanceTrace.record(operationId, operation, 'started');
    pendingNavigationRef.current = operationId;
    pendingNavigationRelatedRef.current = [...related];
    completedNavigationRef.current = null;
    settleResume();
    resumeTargetRef.current = null;
    setResumeTarget(null);
    commitNavigation(next);
    performanceTrace.record(operationId, 'navigation', 'local_feedback');
    performanceTrace.record(operationId, 'navigation', 'intent_committed');
    for (const operation of related) {
      performanceTrace.record(operationId, operation, 'local_feedback');
      performanceTrace.record(operationId, operation, 'intent_committed');
    }
  };

  const resolveCreatedTerminalFromCatalog = (
    created: NonNullable<typeof createdTerminalRef.current>,
    visiblePanels = terminalPanelsRef.current,
  ): boolean => {
    const candidates = visiblePanels.filter((panel) => (
      panel.workspaceCapability === created.workspaceCapability
      && panel.kind === created.kind
    ));
    const match = matchUniqueNewSurface(
      created.existingPanelIds,
      candidates.map((panel) => panel.panelId),
    );
    if (match.kind === 'pending') return false;
    createdTerminalRef.current = null;
    createdTerminalReconciler.stop();
    if (match.kind === 'ambiguous') {
      performanceTrace.record(created.requestId, 'surface_create', 'failed', 'ambiguous');
      surfaceCreateOperation.advance(created.requestId, 'ambiguous');
      setSurfaceCreateError(t('创建后出现多个新窗口，结果无法唯一确认。'));
      setBridgeError('创建后出现多个新窗口，结果无法唯一确认，请在 Mac 端核对。');
      return true;
    }
    const newPanel = candidates.find((panel) => panel.panelId === match.id)!;
    performanceTrace.record(created.requestId, 'surface_create', 'completed', 'ok');
    surfaceCreateOperation.advance(created.requestId, 'completed');
    void playInteractionFeedback({
      action: 'surface_create',
      origin: 'user',
      phase: 'completed',
    });
    setBridgeError(null);
    // A terminal created here is opened here: 只查看 means no takeover for it either.
    carryControlTargetRef.current = preferencesRef.current.autoTakeover !== false
      && shouldTakeoverCreatedTerminal(
        stateRef.current,
        newPanel.panelId,
        visiblePanels,
      ) ? newPanel.panelId : null;
    dispatch({
      type: 'panel_selected',
      panelId: newPanel.panelId,
      draft: terminalDraftSubmission.currentDraft(newPanel.panelId),
    });
    navigate({
      type: 'open_session',
      workspaceCapability: created.workspaceCapability,
      panelId: newPanel.panelId,
    });
    return true;
  };
  const resolveCreatedRoomFromCatalog = (
    created: NonNullable<typeof createdRoomRef.current>,
    rooms = roomPanelsRef.current,
  ): boolean => {
    const candidates = rooms.filter((candidate) => (
      candidate.workspaceCapability === created.workspaceCapability
    ));
    const match = matchUniqueNewSurface(
      created.existingRoomCapabilities,
      candidates.map((candidate) => candidate.panelId),
    );
    if (match.kind === 'pending') return false;
    createdRoomRef.current = null;
    createdRoomReconciler.stop();
    if (match.kind === 'ambiguous') {
      performanceTrace.record(created.requestId, 'surface_create', 'failed', 'ambiguous');
      surfaceCreateOperation.advance(created.requestId, 'ambiguous');
      setSurfaceCreateError(t('创建后出现多个新协作房间，结果无法唯一确认。'));
      setBridgeError('创建后出现多个新协作房间，结果无法唯一确认，请在 Mac 端核对。');
      return true;
    }
    const room = candidates.find((candidate) => candidate.panelId === match.id)!;
    performanceTrace.record(created.requestId, 'surface_create', 'completed', 'ok');
    surfaceCreateOperation.advance(created.requestId, 'completed');
    void playInteractionFeedback({
      action: 'surface_create',
      origin: 'user',
      phase: 'completed',
    });
    showRoom(room.panelId);
    setBridgeError(null);
    dispatch({
      type: 'panel_selected',
      panelId: room.panelId,
      draft: terminalDraftSubmission.currentDraft(room.panelId),
    });
    navigate({
      type: 'open_session',
      workspaceCapability: created.workspaceCapability,
      panelId: room.panelId,
    });
    return true;
  };

  useEffect(() => {
    const operationId = pendingNavigationRef.current;
    if (operationId === null || completedNavigationRef.current === operationId) return;
    completedNavigationRef.current = operationId;
    performanceTrace.record(operationId, 'navigation', 'routed');
    performanceTrace.record(operationId, 'navigation', 'completed', 'ok');
    for (const operation of pendingNavigationRelatedRef.current) {
      performanceTrace.record(operationId, operation, 'routed');
      performanceTrace.record(operationId, operation, 'completed', 'ok');
    }
  }, [performanceTrace, route]);

  useEffect(() => {
    const operation = appStartOperationRef.current;
    if (
      operation === null
      || operation.completed
      || !resumeLoaded
      || !resumeAppliedRef.current
      || (route.kind !== 'root' && !catalogReady)
    ) return;
    operation.completed = true;
    performanceTrace.record(operation.operationId, 'app_start', 'accepted', 'ok');
    performanceTrace.record(operation.operationId, 'app_start', 'completed', 'ok');
  }, [catalogReady, performanceTrace, resumeLoaded, route.kind]);
  const roomImageTransferRef = useRef<RoomImageTransferCoordinator | null>(null);
  roomImageTransferRef.current ??= new RoomImageTransferCoordinator({
    send: async (command) => {
      const current = bridge.current;
      if (current === null) throw new Error('mobile bridge is unavailable');
      await current.send(command);
    },
    requestId: createMobileRequestId,
    digest: digestRoomImage,
  });
  const roomImageTransfer = roomImageTransferRef.current;
  const terminalImageTransferRef = useRef<TerminalImageTransferCoordinator | null>(null);
  terminalImageTransferRef.current ??= new TerminalImageTransferCoordinator({
    send: async (command) => {
      const current = bridge.current;
      if (current === null) throw new Error('mobile bridge is unavailable');
      await current.send(command);
    },
    requestId: createMobileRequestId,
  });
  const terminalImageTransfer = terminalImageTransferRef.current;
  const workspaceFileTransportRef = useRef<WorkspaceFileTransport | null>(null);
  if (workspaceFileTransportRef.current === null) {
    // 截图模式不连电脑：由按同一协议作答的假电脑驱动真实的 transport。
    const storeShotDesktop = STORE_SHOT === null
      ? null
      : createStoreShotFileDesktop(STORE_SHOT.locale, (event) => workspaceFileTransportRef.current?.handle(event));
    workspaceFileTransportRef.current = new WorkspaceFileTransport({
      send: async (command) => {
        if (storeShotDesktop !== null) return storeShotDesktop(command);
        const current = bridge.current;
        if (current === null) throw new Error('mobile bridge is not connected');
        if (!current.supportsWorkspaceFiles) throw new WorkspaceFilesUnsupportedError();
        await current.send(command);
      },
      requestId: createMobileRequestId,
      digest: digestRoomImage,
      acceptsOffice: () => storeShotDesktop === null && bridge.current?.supportsOfficePreview === true,
    });
    if (STORE_SHOT?.scene === 'files') {
      const store = workspaceFileTreeStore(workspaceFileTransportRef.current, STORE_SHOT_WORKSPACE);
      store.ensureRoot();
      for (const dir of STORE_SHOT_EXPANDED_DIRS) store.toggle(dir);
    }
  }
  const workspaceFileTransport = workspaceFileTransportRef.current;
  /** ADR-003 §14：只有桌面在探针 v2 中声明 workspace-files-v1 才出现文件入口。 */
  const [workspaceFilesSupported, setWorkspaceFilesSupported] = useState(STORE_SHOT !== null);
  /** 桌面确实回答了探针但没有文件能力：电脑上的 Connect 版本较旧，文件入口显示「更新后可用」。 */
  const [workspaceFilesNeedDesktopUpdate, setWorkspaceFilesNeedDesktopUpdate] = useState(false);
  const clearRoomComposerImages = (): void => {
    roomImagePickRequestRef.current += 1;
    cleanupPreparedRoomImages(roomComposerImagesRef.current.images);
    const empty = { roomCapability: null, images: [] as PreparedRoomImage[] };
    roomComposerImagesRef.current = empty;
    setRoomComposerImages(empty);
    setRoomImagePickPending(false);
  };
  const clearTerminalComposerImage = (): void => {
    terminalImagePickRequestRef.current += 1;
    const image = terminalComposerImageRef.current.image;
    if (image !== null) cleanupPreparedRoomImages([image]);
    const empty = { panelId: null, image: null };
    terminalComposerImageRef.current = empty;
    setTerminalComposerImage(empty);
    setTerminalImagePickPending(false);
  };
  if (bridge.current === null) {
    bridge.current = new BridgeClient({
      identity,
      performanceTrace,
      callbacks: {
        onAuthorizationRejected: () => {
          void forgetPairingRef.current?.('电脑已吊销这台手机的授权，请重新配对。');
        },
        onState: (connection) => {
          if (connection === 'connected') {
            setPairingRequired(false);
            if (!roomSendAmbiguousRef.current && !terminalWriteAmbiguousRef.current) {
              setBridgeError(null);
            }
            if (
              stateRef.current.connection === 'reconnecting'
              && stateRef.current.pendingIntent === 'reconnect'
            ) {
              dispatch({ type: 'intent_acknowledged', intent: 'reconnect' });
            } else {
              dispatch({ type: 'connection_changed', connection: 'online' });
            }
          } else if (
            connection === 'connecting'
            || connection === 'authenticating'
            || connection === 'confirming'
            || connection === 'reconnecting'
          ) {
            if (connection !== 'confirming') {
              terminalRendererRetryGenerationRef.current += 1;
              setTerminalRendererRetryPending(false);
              attachedPanelIdRef.current = null;
              terminalRecovery.releasePending();
              terminalSwap.reset();
              syncTerminalSwapStatus();
              setCatalogReady(false);
              collaborationProfileCapabilityRef.current = null;
              collaborationProfileRequestRef.current = null;
              collaborationProfileRetriedRef.current = false;
              if (collaborationAvatarOperationRef.current !== null) {
                collaborationAvatarOperationRef.current = null;
                setCollaborationAvatarPending(false);
                setCollaborationAvatarError('连接已变化，头像结果未能确认，请重试。');
              }
              const pendingCreate = pendingSurfaceCreateRef.current;
              if (pendingCreate !== null) {
                pendingSurfaceCreateRef.current = null;
                performanceTrace.record(
                  pendingCreate.requestId,
                  'surface_create',
                  'failed',
                  'ambiguous',
                );
                surfaceCreateOperation.advance(pendingCreate.requestId, 'ambiguous');
                setSurfaceCreateError('连接已变化，创建结果未能确认。');
              }
              const reconcilingCreate = createdTerminalRef.current ?? createdRoomRef.current;
              if (reconcilingCreate !== null) {
                performanceTrace.record(
                  reconcilingCreate.requestId,
                  'surface_create',
                  'failed',
                  'ambiguous',
                );
                surfaceCreateOperation.advance(reconcilingCreate.requestId, 'ambiguous');
                setSurfaceCreateError('连接已变化，创建结果未能确认。');
              }
              createdTerminalRef.current = null;
              createdRoomRef.current = null;
              createdTerminalReconciler.stop();
              createdRoomReconciler.stop();
              terminalImageTransfer.cancelForDisconnect();
              workspaceFileTransport.cancelForDisconnect();
              if (pendingRoomSendRef.current !== null) {
                const pending = pendingRoomSendRef.current;
                clearPendingRoomMessage(pending);
                pendingRoomSendRef.current = null;
                performanceTrace.record(pending.requestId, 'room_send', 'failed', 'ambiguous');
                roomSendAmbiguousRef.current = true;
                finishDraftSubmission('ambiguous', pending.requestId);
                setBridgeError('协作消息结果未能确认，请连接后先查看房间记录。');
              }
              if (pendingSurfaceCloseRef.current !== null) {
                performanceTrace.record(
                  pendingSurfaceCloseRef.current.requestId,
                  'surface_close',
                  'failed',
                  'ambiguous',
                );
                const pendingClose = pendingSurfaceCloseRef.current;
                pendingSurfaceCloseRef.current = null;
                surfaceCloseOperation.advance(pendingClose.requestId, 'ambiguous');
                setBridgeError('连接已变化，关闭结果未能确认。');
              }
              const pendingOwnership = ownershipRequestRef.current;
              if (pendingOwnership !== null) {
                failOwnershipRequest(
                  pendingOwnership.intent,
                  pendingOwnership.requestId,
                  '控制权结果未能确认，请连接后核对当前状态。',
                );
              }
            }
            const terminalWritePending = terminalWriteConfirmation.busy;
            const pendingRender = pendingTerminalRenderRef.current;
            if (
              pendingRender !== null
              && (connection !== 'confirming' || terminalWritePending)
            ) {
              pendingTerminalRenderRef.current = null;
              performanceTrace.record(
                pendingRender.requestId,
                'terminal_render',
                'failed',
                terminalWritePending ? 'ambiguous' : 'retryable',
              );
            }
            if (terminalWriteConfirmation.release()) {
              terminalWriteAmbiguousRef.current = true;
              finishDraftSubmission('ambiguous');
              setBridgeError('终端输入结果未能确认，请连接后先查看终端输出。');
            }
            dispatch({
              type: 'connection_changed',
              connection: connection === 'confirming' ? 'confirming' : 'reconnecting',
            });
          } else {
            setCatalogReady(false);
            roomImageTransfer.cancelForDisconnect();
            terminalImageTransfer.cancelForDisconnect();
            workspaceFileTransport.cancelForDisconnect();
            terminalRecovery.releasePending();
            clearRefresh('failed');
            clearOwnershipConfirmTimer();
            const reconcilingCreate = createdTerminalRef.current ?? createdRoomRef.current;
            if (reconcilingCreate !== null) {
              performanceTrace.record(
                reconcilingCreate.requestId,
                'surface_create',
                'failed',
                'ambiguous',
              );
              surfaceCreateOperation.advance(reconcilingCreate.requestId, 'ambiguous');
              setSurfaceCreateError('连接已断开，创建结果未能确认。');
            }
            createdTerminalReconciler.stop();
            createdRoomReconciler.stop();
            closedTerminalReconciler.stop();
            ownershipReconciler.stop();
            ownershipRequestRef.current = null;
            carryControlTargetRef.current = null;
            createdTerminalRef.current = null;
            createdRoomRef.current = null;
            closedTerminalRef.current = null;
            closedPanelIdsRef.current.clear();
            attachedPanelIdRef.current = null;
            const pendingRender = pendingTerminalRenderRef.current;
            if (pendingRender !== null) {
              pendingTerminalRenderRef.current = null;
              performanceTrace.record(
                pendingRender.requestId,
                'terminal_render',
                'failed',
                terminalWriteConfirmation.busy ? 'ambiguous' : 'retryable',
              );
            }
            if (terminalWriteConfirmation.release()) {
              terminalWriteAmbiguousRef.current = true;
              finishDraftSubmission('ambiguous');
              setBridgeError('终端输入结果未能确认，请连接后先查看终端输出。');
            }
            if (pendingRoomSendRef.current !== null) {
              const pending = pendingRoomSendRef.current;
              clearPendingRoomMessage(pending);
              pendingRoomSendRef.current = null;
              performanceTrace.record(pending.requestId, 'room_send', 'failed', 'ambiguous');
              roomSendAmbiguousRef.current = true;
              finishDraftSubmission('ambiguous', pending.requestId);
              setBridgeError('协作消息结果未能确认，请连接后先查看房间记录。');
            }
            if (pendingSurfaceCreateRef.current !== null) {
              const pendingCreate = pendingSurfaceCreateRef.current;
              performanceTrace.record(
                pendingCreate.requestId,
                'surface_create',
                'failed',
                'ambiguous',
              );
              pendingSurfaceCreateRef.current = null;
              surfaceCreateOperation.advance(pendingCreate.requestId, 'ambiguous');
              setSurfaceCreateError('连接已断开，创建结果未能确认。');
            }
            if (pendingSurfaceCloseRef.current !== null) {
              performanceTrace.record(
                pendingSurfaceCloseRef.current.requestId,
                'surface_close',
                'failed',
                'ambiguous',
              );
              const pendingClose = pendingSurfaceCloseRef.current;
              pendingSurfaceCloseRef.current = null;
              surfaceCloseOperation.advance(pendingClose.requestId, 'ambiguous');
              setBridgeError('连接已断开，关闭结果未能确认。');
            }
            dispatch({ type: 'connection_changed', connection: 'offline' });
          }
        },
        onCatalogReady: () => {
          setCatalogReady(true);
        },
        onPayloadRejected: ({ panelId }) => {
          // The channel is intact; only this panel's picture is unusable. Ask
          // for a clean full frame, and if that keeps coming back unusable,
          // land on the compatibility renderer rather than re-attaching forever.
          //
          // A desktop session holds exactly one attachment, so re-attaching a
          // panel the user has already left would silently steal the live one's
          // subscription — the visible terminal would just stop. Payloads that
          // name no panel, or name one that is not the terminal on screen, are
          // recorded and dropped; a collaboration room is not a terminal at all.
          const target = panelId ?? stateRef.current.activePanelId;
          if (target === null) return;
          const active = stateRef.current.panels.find(
            (panel) => panel.panelId === stateRef.current.activePanelId,
          );
          if (target !== active?.panelId || active.kind === 'collaboration') {
            payloadRejection.record(target);
            return;
          }
          const action = payloadRejection.record(target);
          if (action === 'block') {
            terminalRecovery.block(target, '终端画面无法显示，请在电脑上查看这个会话。');
            failTerminalSwap(target);
            if (stateRef.current.activePanelId === target) {
              setBridgeError('终端画面无法显示，请在电脑上查看这个会话。');
            }
            return;
          }
          if (action === 'fallback') {
            fallBackToCompatibilityRenderer(target);
            return;
          }
          if (!terminalRecovery.beginAutomatic(target)) return;
          terminalTranscripts.invalidate(target);
          const operationId = createMobileRequestId();
          beginTerminalSwap(target, operationId, true);
          void bridge.current?.attach(target, true, operationId).catch(() => {
            terminalRecovery.fail(target);
            failTerminalSwap(target, operationId);
            setBridgeError('终端画面需要重新同步，请检查连接。');
          });
        },
        onServerCapabilities: (capabilities) => {
          setWorkspaceFilesSupported(capabilities.workspaceFiles);
          setWorkspaceFilesNeedDesktopUpdate(!capabilities.workspaceFiles && capabilities.answered);
        },
        onEvent: (event) => {
          if (workspaceFileTransport.handle(event)) return;
          if (terminalImageTransfer.handle(event)) return;
          if (roomImageTransfer.handle(event)) return;
          if (
            event.kind === 'error'
            && event.requestId !== undefined
            && collaborationProfileRequestRef.current?.requestId === event.requestId
          ) {
            collaborationProfileRequestRef.current = null;
            collaborationProfileCapabilityRef.current = null;
            setCollaborationAvatarError('协作头像同步失败，请刷新后重试。');
            if (!collaborationProfileRetriedRef.current) {
              collaborationProfileRetriedRef.current = true;
              void bridge.current?.send({
                kind: 'listWorkspaces',
                requestId: createMobileRequestId(),
              }).catch(() => {});
            }
            return;
          }
          if (
            event.kind === 'error'
            && event.requestId !== undefined
            && collaborationAvatarOperationRef.current?.requestId === event.requestId
          ) {
            collaborationAvatarOperationRef.current = null;
            setCollaborationAvatarPending(false);
            setCollaborationAvatarError(
              event.code === 'collaboration_avatar_throttled'
                ? '头像修改太频繁，请稍后再试。'
                : event.code === 'workspace_capability_expired'
                  ? '项目授权已变化，请刷新后重试。'
                  : event.code === 'mobile_bridge_rejected'
                    ? '当前设备没有修改头像的权限。'
                    : '头像更新失败，请重试。',
            );
            return;
          }
          let handledSurfaceRequestError = false;
          if (
            event.kind === 'error'
            && event.requestId !== undefined
            && terminalWriteConfirmation.reject(event.requestId)
          ) {
            if (pendingTerminalRenderRef.current?.requestId === event.requestId) {
              pendingTerminalRenderRef.current = null;
            }
            performanceTrace.record(
              event.requestId,
              'terminal_render',
              'failed',
              event.category,
            );
            terminalWriteAmbiguousRef.current = event.category === 'ambiguous';
            finishDraftSubmission(
              event.category === 'ambiguous' ? 'ambiguous' : 'failed',
              event.requestId,
            );
            setBridgeError(
              event.category === 'ambiguous'
                ? '终端输入结果未能确认，请先查看终端输出。'
                : event.code === 'epoch_denied'
                ? '控制权已变化，终端输入未发送。'
                : event.code === 'mobile_bridge_rejected'
                  ? '当前设备没有写入权限，终端输入未发送。'
                  : event.code === 'workspace_authorization_expired'
                    ? '工作区授权已失效，终端输入未发送。'
                    : '终端输入被电脑拒绝，请检查权限后重试。',
            );
            return;
          }
          const pendingRoomSend = pendingRoomSendRef.current;
          if (
            event.kind === 'error'
            && event.requestId !== undefined
            && pendingRoomSend?.requestId === event.requestId
          ) {
            if (event.code === 'room_send_pending') return;
            clearPendingRoomMessage(pendingRoomSend);
            pendingRoomSendRef.current = null;
            performanceTrace.record(event.requestId, 'room_send', 'failed', event.category);
            roomSendAmbiguousRef.current = false;
            finishDraftSubmission(
              event.category === 'ambiguous' ? 'ambiguous' : 'failed',
              event.requestId,
            );
            setBridgeError(
              event.code === 'room_send_throttled'
                ? '消息发送太频繁，请稍后再试。'
                : event.code === 'room_capability_expired'
                    ? '协作房间状态已变化，请刷新后重试。'
                    : event.code === 'room_authorization_expired'
                      ? '协作房间授权已失效，请在 Mac 重新授权后刷新。'
                    : '协作消息发送失败，请检查权限后重试。',
            );
            return;
          }
          if (
            event.kind === 'error'
            && event.requestId !== undefined
            && pendingSurfaceCreateRef.current?.requestId === event.requestId
          ) {
            const requestId = event.requestId;
            handledSurfaceRequestError = true;
            performanceTrace.record(
              requestId,
              'surface_create',
              'failed',
              event.category,
            );
            pendingSurfaceCreateRef.current = null;
            surfaceCreateOperation.advance(
              requestId,
              event.category === 'ambiguous' ? 'ambiguous' : 'failed',
            );
            setSurfaceCreateError(
              event.code === 'surface_create_throttled'
                ? '操作太频繁，请稍后再试。'
                : event.code === 'workspace_capability_expired'
                  ? '项目状态已变化，请刷新后重试。'
                  : event.category === 'ambiguous'
                      ? '创建结果未能确认，请先在 Mac 端核对。'
                      : '创建失败，请检查权限后重试。',
            );
          }
          if (
            event.kind === 'error'
            && event.requestId !== undefined
            && pendingSurfaceCloseRef.current?.requestId === event.requestId
          ) {
            handledSurfaceRequestError = true;
            performanceTrace.record(
              event.requestId,
              'surface_close',
              'failed',
              event.category,
            );
            pendingSurfaceCloseRef.current = null;
            surfaceCloseOperation.advance(
              event.requestId,
              event.category === 'ambiguous' ? 'ambiguous' : 'failed',
            );
            setBridgeError(
              event.code === 'surface_close_throttled'
                ? '关闭操作太频繁，请稍后再试。'
                : event.code === 'epoch_denied'
                    ? '窗口控制状态已变化，请刷新后重试。'
                    : event.category === 'ambiguous'
                      ? '关闭结果未能确认，请先在 Mac 端核对。'
                      : '关闭失败，请检查权限后重试。',
            );
          }
          if (handledSurfaceRequestError) return;
          if (event.kind === 'error' && refreshRef.current?.requestId === event.requestId) {
            const detail = terminalSnapshotFailureDetail(event.code)
              ?? '项目与会话刷新失败，请检查连接后重试。';
            if (event.panelId !== undefined && terminalSnapshotFailureDetail(event.code) !== null) {
              terminalRecovery.block(event.panelId, detail);
            }
            if (
              event.panelId === undefined
              || stateRef.current.activePanelId === event.panelId
            ) terminalRef.current?.reportRecoveryFailed();
            clearRefresh(event.category === 'ambiguous' ? 'ambiguous' : 'failed', event.requestId);
            setBridgeError(detail);
            return;
          }
          if (event.kind === 'collaborationProfile') {
            setCollaborationAvatar(event.avatar);
            if (event.requestId === collaborationProfileRequestRef.current?.requestId) {
              collaborationProfileRequestRef.current = null;
              collaborationProfileRetriedRef.current = false;
              setCollaborationAvatarError(null);
            }
            const pending = collaborationAvatarOperationRef.current;
            if (event.requestId !== undefined && pending?.requestId === event.requestId) {
              collaborationAvatarOperationRef.current = null;
              setCollaborationAvatarPending(false);
              setCollaborationAvatarError(null);
            }
          } else if (event.kind === 'workspaceList') {
            acceptRefreshPart(event.requestId, 'workspaces');
            dispatch({ type: 'workspaces_changed', workspaces: event.workspaces });
            const workspaceCapability = collaborationProfileWorkspace(event.workspaces)
              ?.workspaceCapability ?? null;
            if (
              workspaceCapability !== null
              && collaborationProfileCapabilityRef.current !== workspaceCapability
            ) {
              if (collaborationProfileCapabilityRef.current !== null) {
                collaborationProfileRetriedRef.current = false;
              }
              collaborationProfileCapabilityRef.current = workspaceCapability;
              const requestId = createMobileRequestId();
              collaborationProfileRequestRef.current = { requestId, workspaceCapability };
              void bridge.current?.send({
                kind: 'getCollaborationProfile',
                requestId,
                workspaceCapability,
              }).catch(() => {
                if (collaborationProfileCapabilityRef.current === workspaceCapability) {
                  collaborationProfileCapabilityRef.current = null;
                  collaborationProfileRequestRef.current = null;
                  setCollaborationAvatarError('协作头像同步失败，请刷新后重试。');
                }
              });
            }
          } else if (event.kind === 'panelList') {
            acceptRefreshPart(event.requestId, 'panels');
            const created = createdTerminalRef.current;
            const closing = closedTerminalRef.current;
            if (closing !== null && !event.panels.some((panel) => panel.panelId === closing)) {
              closedTerminalRef.current = null;
              closedPanelIdsRef.current.delete(closing);
              closedTerminalReconciler.stop();
              setBridgeError(null);
            }
            const visiblePanels = event.panels.filter(
              (panel) => !closedPanelIdsRef.current.has(panel.panelId),
            );
            const livePanelIds = new Set(visiblePanels.map((panel) => panel.panelId));
            terminalRecovery.forgetMissing(livePanelIds);
            terminalPanelsRef.current = visiblePanels;
            publishSessionPanels();
            if (created !== null && event.requestId === created.requestId) {
              resolveCreatedTerminalFromCatalog(created, visiblePanels);
            }
          } else if (event.kind === 'panelStates') {
            // The desktop sends the whole set each time: replace, never merge.
            setPanelStatuses(Object.fromEntries(event.panels.map((panel) => [panel.panelId, panel.status])));
          } else if (event.kind === 'roomList') {
            acceptRefreshPart(event.requestId, 'rooms');
            const rooms: SessionPanelSummary[] = event.rooms.map((room) => ({
              panelId: room.roomCapability,
              kind: 'collaboration',
              label: room.label,
              workspaceCapability: room.workspaceCapability,
              workspaceLabel: room.workspaceLabel,
            }));
            roomPanelsRef.current = rooms;
            const liveCapabilities = new Set(rooms.map((room) => room.panelId));
            for (const capability of roomCacheRef.current.keys()) {
              if (!liveCapabilities.has(capability)) roomCacheRef.current.delete(capability);
            }
            publishSessionPanels();
            const createdRoom = createdRoomRef.current;
            if (createdRoom !== null && event.requestId === createdRoom.requestId) {
              resolveCreatedRoomFromCatalog(createdRoom, rooms);
            }
          } else if (event.kind === 'roomHistory') {
            const cached = roomCacheRef.current.get(event.roomCapability);
            const merged = mergeBoundedRoomMessages(
              event.messages,
              cached?.messages ?? [],
            );
            storeRoom(
              event.roomCapability,
              merged.messages,
              Math.max(event.omittedMessages, cached?.omittedMessages ?? 0)
                + merged.omittedMessages,
            );
          } else if (event.kind === 'roomMessage') {
            const cached = roomCacheRef.current.get(event.roomCapability)
              ?? { messages: [], omittedMessages: 0 };
            const merged = mergeBoundedRoomMessages(cached.messages, [event.message]);
            storeRoom(
              event.roomCapability,
              merged.messages,
              cached.omittedMessages + merged.omittedMessages,
            );
          } else if (event.kind === 'roomSendAccepted') {
            const pending = pendingRoomSendRef.current;
            if (
              pending?.requestId !== event.requestId
              || pending.roomCapability !== event.roomCapability
            ) return;
            clearPendingRoomMessage(pending);
            pendingRoomSendRef.current = null;
            performanceTrace.record(event.requestId, 'room_send', 'accepted', 'ok');
            performanceTrace.record(event.requestId, 'room_send', 'completed', 'ok');
            roomSendAmbiguousRef.current = false;
            finishDraftSubmission('completed', event.requestId);
            setBridgeError(null);
          } else if (event.kind === 'terminalWriteAccepted') {
            if (!terminalWriteConfirmation.accept(event.requestId, event.panelId)) return;
            performanceTrace.record(event.requestId, 'terminal_render', 'accepted', 'ok');
            terminalWriteAmbiguousRef.current = false;
            finishDraftSubmission('completed', event.requestId);
            setBridgeError(null);
          } else if (event.kind === 'surfaceCreateAccepted') {
            const pending = pendingSurfaceCreateRef.current;
            if (pending?.requestId !== event.requestId) return;
            pendingSurfaceCreateRef.current = null;
            performanceTrace.record(event.requestId, 'surface_create', 'accepted', 'ok');
            if (pending.surfaceKind !== 'collaboration') {
              const createdTerminal = {
                requestId: event.requestId,
                workspaceCapability: pending.workspaceCapability,
                kind: pending.surfaceKind,
                existingPanelIds: pending.existingPanelIds,
              };
              createdTerminalRef.current = createdTerminal;
              if (!resolveCreatedTerminalFromCatalog(createdTerminal)) createdTerminalReconciler.start(
                () => {
                  void bridge.current?.send({
                    kind: 'listPanels',
                    requestId: createdTerminal.requestId,
                  }).catch(() => {});
                },
                () => {
                  if (createdTerminalRef.current !== createdTerminal) return;
                  createdTerminalRef.current = null;
                  performanceTrace.record(
                    createdTerminal.requestId,
                    'surface_create',
                    'failed',
                    'retryable',
                  );
                  surfaceCreateOperation.advance(createdTerminal.requestId, 'failed');
                  setSurfaceCreateError(t('窗口已在 Mac 创建，但手机未及时发现。'));
                  setBridgeError('窗口已在 Mac 创建，但手机未及时发现，请刷新会话列表。');
                },
              );
            } else {
              const createdRoom = {
                requestId: event.requestId,
                workspaceCapability: pending.workspaceCapability,
                existingRoomCapabilities: new Set(pending.existingPanelIds),
              };
              createdRoomRef.current = createdRoom;
              if (!resolveCreatedRoomFromCatalog(createdRoom)) createdRoomReconciler.start(
                () => {
                  void bridge.current?.send({
                    kind: 'listRooms',
                    requestId: createdRoom.requestId,
                  }).catch(() => {});
                },
                () => {
                  if (createdRoomRef.current !== createdRoom) return;
                  createdRoomRef.current = null;
                  performanceTrace.record(
                    createdRoom.requestId,
                    'surface_create',
                    'failed',
                    'retryable',
                  );
                  surfaceCreateOperation.advance(createdRoom.requestId, 'failed');
                  setSurfaceCreateError(t('协作房间已在 Mac 创建，但手机未及时发现。'));
                  setBridgeError('协作房间已在 Mac 创建，但手机未及时发现，请刷新会话列表。');
                },
              );
            }
            setSurfaceCreateError(null);
            surfaceCreateOperation.advance(event.requestId, 'accepted');
          } else if (event.kind === 'surfaceCloseAccepted') {
            const pending = pendingSurfaceCloseRef.current;
            if (pending?.requestId !== event.requestId || pending.panelId !== event.panelId) return;
            const panelsBeforeClose = stateRef.current.panels;
            const adjacentPanel = adjacentPanelAfterClose(panelsBeforeClose, event.panelId);
            const remainingPanels = panelsBeforeClose.filter(
              (panel) => panel.panelId !== event.panelId,
            );
            performanceTrace.record(event.requestId, 'surface_close', 'accepted', 'ok');
            pendingSurfaceCloseRef.current = null;
            surfaceCloseOperation.advance(event.requestId, 'accepted');
            closedTerminalRef.current = event.panelId;
            closedPanelIdsRef.current.add(event.panelId);
            terminalTranscripts.remove(event.panelId);
            terminalGridStore.remove(event.panelId);
            terminalGeometryGuard.remove(event.panelId);
            if (attachedPanelIdRef.current === event.panelId) attachedPanelIdRef.current = null;
            carryControlTargetRef.current = null;
            dispatch({
              type: 'panels_changed',
              panels: remainingPanels,
              selectedDraft: adjacentPanel === null
                ? ''
                : terminalDraftSubmission.currentDraft(adjacentPanel.panelId),
            });
            if (routeRef.current.kind === 'session' && routeRef.current.panelId === event.panelId) {
              const workspaceCapability = adjacentPanel?.workspaceCapability
                ?? routeRef.current.workspaceCapability;
              if (adjacentPanel) {
                if (adjacentPanel.kind === 'collaboration') showRoom(adjacentPanel.panelId);
                dispatch({
                  type: 'panel_selected',
                  panelId: adjacentPanel.panelId,
                  draft: terminalDraftSubmission.currentDraft(adjacentPanel.panelId),
                });
                navigate({
                  type: 'open_session',
                  workspaceCapability,
                  panelId: adjacentPanel.panelId,
                }, adjacentPanel.kind === 'collaboration' ? [] : ['terminal_switch']);
              } else {
                navigate({ type: 'back' });
              }
            }
            performanceTrace.record(event.requestId, 'surface_close', 'completed', 'ok');
            surfaceCloseOperation.advance(event.requestId, 'completed');
            // 这两处刷新属于恢复路径，失败必须报出来，不能静默（验收 P3-02）。
            // App.tsx 其余机会性刷新保持静默 catch——它们有别的恢复路径兜底。
            const refreshPanelsForCloseRecovery = (): void => {
              const client = bridge.current;
              runRecoveryRefresh(
                client === null ? null : () => client.send({ kind: 'listPanels' }),
                () => {
                  setBridgeError('窗口已关闭，但终端清理未及时确认，请刷新会话列表。');
                },
              );
            };
            closedTerminalReconciler.start(
              refreshPanelsForCloseRecovery,
              () => {
                if (closedTerminalRef.current !== event.panelId) return;
                closedTerminalRef.current = null;
                closedPanelIdsRef.current.delete(event.panelId);
                setBridgeError('窗口已关闭，但终端清理未及时确认，请刷新会话列表。');
                refreshPanelsForCloseRecovery();
              },
            );
          } else if (event.kind === 'deviceAccess') {
            dispatch({ type: 'device_access_changed', scopes: event.scopes });
          } else if (event.kind === 'ownership') {
            if (!acceptsOwnershipUpdate(stateRef.current, {
              panelId: event.panelId,
              owner: event.owner,
              epoch: event.epoch,
              controlledByThisDevice: event.controlledByThisDevice === true,
            })) return;
            const pendingOwnership = ownershipRequestRef.current;
            const disposition = ownershipEventDisposition(
              pendingOwnership?.requestId ?? null,
              event.requestId,
            );
            if (disposition === 'ignore_stale') return;
            const matchesPending = ownershipReplyMatches(
              pendingOwnership,
              event.requestId,
              event.panelId,
            );
            if (pendingOwnership !== null && disposition === 'settle' && !matchesPending) return;
            const settlesPending = pendingOwnership === null || matchesPending;
            if (pendingOwnership !== null && matchesPending) {
              clearOwnershipConfirmTimer();
              ownershipRequestRef.current = null;
              ownershipReconciler.stop();
              performanceTrace.record(
                pendingOwnership.requestId,
                'ownership',
                'accepted',
                'ok',
              );
              performanceTrace.record(
                pendingOwnership.requestId,
                'ownership',
                'completed',
                'ok',
              );
              if (
                pendingOwnership.intent === 'takeover'
                && pendingOwnership.origin === 'user'
                && event.owner === 'mobile'
                && event.controlledByThisDevice === true
              ) {
                void playInteractionFeedback({
                  action: 'takeover',
                  origin: 'user',
                  phase: 'completed',
                });
              }
            }
            if (
              matchesPending
              || (pendingOwnership === null && stateRef.current.activePanelId === event.panelId)
            ) {
              ownershipReconciler.stop();
              setBridgeError((current) => (
                isRecoverableOwnershipError(current) ? null : current
              ));
            }
            dispatch({
              type: 'ownership_changed',
              panelId: event.panelId,
              owner: event.owner,
              epoch: event.epoch,
              controlledByThisDevice: event.controlledByThisDevice === true,
              settlesPending,
            });
            if (carryControlTargetRef.current === event.panelId) {
              carryControlTargetRef.current = null;
              if (
                event.owner === 'desktop'
                && stateRef.current.connection === 'online'
                && stateRef.current.canControlInput
                && ownershipRequestRef.current === null
              ) {
                requestAutomaticTakeover(event.panelId, '新终端控制权请求未能确认，请检查连接。');
              }
            }
          } else if (event.kind === 'terminalGridFrame') {
            const result = terminalGridStore.accept(event as TerminalGridFrame);
            // The desktop drops a rate-limited resize without answering; the
            // frames are the only word on which shape the PTY actually took.
            ptyGeometryRef.current?.observe(event.panelId, { cols: event.cols, rows: event.rows });
            const activePanel = stateRef.current.activePanelId === event.panelId;
            const swapOperationId = activePanel && result.kind !== 'recovery_required'
              ? terminalSwap.frameReady(event.panelId)
              : null;
            const disposition = terminalGridFrameDisposition(result, {
              activePanel,
              swapOperationId,
            });
            if (disposition.recovery === 'complete') terminalRecovery.complete(event.panelId);
            else if (disposition.recovery === 'release') terminalRecovery.fail(event.panelId);
            if (disposition.recover) {
              const operationId = createMobileRequestId();
              beginTerminalSwap(event.panelId, operationId, true);
              void bridge.current?.attach(event.panelId, true, operationId).catch(() => {
                failTerminalSwap(event.panelId, operationId);
                setBridgeError('原生终端状态需要重新同步，请检查连接。');
              });
              return;
            }
            if (disposition.present === null) return;
            setTerminalRendererRetryPending(false);
            setTerminalRendererFallback(false);
            // `swapOperationId` decides frame admission and must stay the
            // one-shot answer from `frameReady`. What the presenter carries is
            // a different question: until the paint is reported, every frame
            // still belongs to the same unfinished operation.
            const presentOperationId = swapOperationId
              ?? terminalSwap.paintingOperationId(event.panelId);
            payloadRejection.clear(event.panelId);
            setNativeGridPresentation({
              frame: disposition.present,
              ...(presentOperationId === null ? {} : { operationId: presentOperationId }),
            });
            syncTerminalSwapStatus();
            setBridgeError(null);
          } else if (event.kind === 'attachReady') {
            const swap = terminalSwap.snapshot();
            if (swap.targetPanelId === event.panelId && swap.operationId === event.requestId) {
              if (terminalRendererRef.current === 'legacy-webview') {
                presentPreparedTerminalFrame(event.panelId);
              }
            }
          } else if (event.kind === 'ptyReplay') {
            if (event.cols !== undefined && event.rows !== undefined) {
              const geometry = { cols: event.cols, rows: event.rows };
              const accepted = terminalGeometryGuard.replace(
                event.panelId,
                geometry,
                event.snapshotSeq,
              );
              if (accepted && event.snapshot !== undefined && event.snapshotSeq !== undefined) {
                const delivery = deliverTerminalSnapshot({
                  activePanelId: terminalSwap.replacementPanelId(),
                  cache: terminalTranscripts,
                  data: event.snapshot,
                  geometry,
                  panelId: event.panelId,
                  terminal: terminalRef.current,
                  trimmedLines: event.omittedLines ?? 0,
                  sequence: event.snapshotSeq,
                });
                if (delivery.presented) {
                  setBridgeError(null);
                  terminalRef.current?.setGeometry(geometry);
                }
                presentPreparedTerminalFrame(
                  event.panelId,
                  [{ data: event.snapshot, geometry }],
                  { trimmedLines: event.omittedLines ?? 0 },
                );
              } else if (accepted) {
                if (
                  terminalSwap.snapshot().targetPanelId === event.panelId
                  && terminalSwap.snapshot().phase === 'preparing'
                ) {
                  terminalTranscripts.replaceSnapshot(
                    event.panelId,
                    '',
                    geometry,
                    event.omittedLines ?? 0,
                  );
                }
                if (terminalSwap.outputPanelId() === event.panelId) {
                  terminalRef.current?.setGeometry(geometry);
                }
              }
              if (accepted) terminalRecovery.complete(event.panelId);
            } else {
              terminalRecovery.complete(event.panelId);
            }
          } else if (event.kind === 'ptyExit') {
            const exitMarker = `\r\n\x1b[90m[${t('终端已退出，状态 {code}', { code: event.exitCode })}]\x1b[0m\r\n`;
            const appended = terminalTranscripts.appendExit(event.id, exitMarker);
            if (appended && terminalSwap.outputPanelId() === event.id) {
              terminalRef.current?.write(exitMarker);
            }
            dispatch({ type: 'panel_exited', panelId: event.id });
          } else if (event.kind === 'error' && event.code === 'terminal_grid_unavailable') {
            fallBackToCompatibilityRenderer(event.panelId ?? stateRef.current.activePanelId);
          } else if (event.kind === 'error' && event.code === 'epoch_denied') {
            setBridgeError('控制权已变化，请按当前状态重新操作。');
          } else if (
            event.kind === 'error'
            && terminalSnapshotFailureDetail(event.code) !== null
          ) {
            const detail = terminalSnapshotFailureDetail(event.code)!;
            if (event.panelId !== undefined) {
              terminalRecovery.block(event.panelId, detail);
              failTerminalSwap(event.panelId);
            }
            if (
              event.panelId === undefined
              || stateRef.current.activePanelId === event.panelId
            ) {
              terminalRef.current?.reportRecoveryFailed();
              setBridgeError(detail);
            }
          } else if (event.kind === 'error') {
            if (event.requestId !== undefined) {
              const swap = terminalSwap.snapshot();
              if (swap.targetPanelId !== null && swap.operationId === event.requestId) {
                failTerminalSwap(swap.targetPanelId, event.requestId);
              }
            }
            carryControlTargetRef.current = null;
            const pendingOwnership = ownershipRequestRef.current;
            if (
              pendingOwnership !== null
              && event.requestId === pendingOwnership.requestId
            ) {
              clearOwnershipConfirmTimer();
              ownershipRequestRef.current = null;
              performanceTrace.record(
                pendingOwnership.requestId,
                'ownership',
                'failed',
                event.category,
              );
              dispatch({
                type: 'intent_failed',
                intent: pendingOwnership.intent,
                category: event.category,
              });
            }
            setBridgeError(
              event.category === 'action_required'
                ? '需要先在电脑端完成授权。'
                : '电脑拒绝了这次操作，请检查权限与连接状态。',
            );
          }
        },
        onPtyData: (event, timing) => {
          const geometry = event.cols === undefined || event.rows === undefined
            ? undefined
            : { cols: event.cols, rows: event.rows };
          const pendingRender = pendingTerminalRenderRef.current;
          const renderOperationId = pendingRender !== null
            && !pendingRender.ptyObserved
            && pendingRender.panelId === event.id
            ? pendingRender.requestId
            : undefined;
          if (renderOperationId !== undefined) {
            pendingTerminalRenderRef.current!.ptyObserved = true;
            performanceTrace.recordAt(
              renderOperationId,
              'terminal_render',
              'socket_received',
              timing.socketReceivedAtMs,
            );
            performanceTrace.recordAt(
              renderOperationId,
              'terminal_render',
              'decrypted',
              timing.decryptedAtMs,
            );
            performanceTrace.recordAt(
              renderOperationId,
              'terminal_render',
              'rn_dispatched',
              timing.rnDispatchedAtMs,
            );
            performanceTrace.record(renderOperationId, 'terminal_render', 'pty_output');
          }
          const delivery = deliverTerminalOutput({
            activePanelId: terminalSwap.outputPanelId(),
            cache: terminalTranscripts,
            data: event.data,
            geometry,
            geometryGuard: terminalGeometryGuard,
            panelId: event.id,
            terminal: terminalRef.current,
            renderOperationId,
            sequence: event.upperSeq ?? event.seq,
          });
          if (delivery.recoveryRequired !== true) return;
          if (stateRef.current.activePanelId !== event.id) return;
          if (!terminalRecovery.beginAutomatic(event.id)) return;
          const operationId = createMobileRequestId();
          beginTerminalSwap(event.id, operationId, true);
          terminalRef.current?.reportRecoveryStarted();
          void bridge.current?.attach(event.id, true, operationId).catch(() => {
            terminalGeometryGuard.fail(event.id);
            terminalRecovery.fail(event.id);
            failTerminalSwap(event.id, operationId);
            terminalRef.current?.reportRecoveryFailed();
            if (stateRef.current.activePanelId === event.id) {
              setBridgeError('终端尺寸恢复失败，请刷新后重试。');
            }
          });
        },
        onPtyHistory: (history) => {
          const delivery = deliverTerminalHistory({
            activePanelId: terminalSwap.replacementPanelId(),
            cache: terminalTranscripts,
            geometryGuard: terminalGeometryGuard,
            panelId: history.panelId,
            segments: history.segments,
            terminal: terminalRef.current,
            trimmedLines: history.omittedLines,
            sequence: history.upperSeq,
          });
          if (delivery.presented) setBridgeError(null);
          if (delivery.recoveryRequired !== true) {
            presentPreparedTerminalFrame(
              history.panelId,
              history.segments,
              { trimmedLines: history.omittedLines },
            );
            return;
          }
          if (stateRef.current.activePanelId !== history.panelId) return;
          if (!terminalRecovery.beginAutomatic(history.panelId)) return;
          const operationId = createMobileRequestId();
          beginTerminalSwap(history.panelId, operationId, true);
          void bridge.current?.attach(history.panelId, true, operationId).catch(() => {
            terminalGeometryGuard.fail(history.panelId);
            terminalRecovery.fail(history.panelId);
            failTerminalSwap(history.panelId, operationId);
            if (stateRef.current.activePanelId === history.panelId) {
              setBridgeError('终端历史尺寸恢复失败，请刷新后重试。');
            }
          });
        },
        onOutputLoss: (panelId, lines) => {
          terminalTranscripts.reportLoss(panelId, lines);
          if (terminalSwap.outputPanelId() === panelId) {
            terminalRef.current?.reportOutputLoss(lines);
          }
        },
        onOutputTrimmed: (panelId, lines) => {
          terminalTranscripts.reportTrimmed(panelId, lines);
          if (terminalSwap.outputPanelId() === panelId) {
            terminalRef.current?.reportOutputTrimmed(lines);
          }
        },
        onTerminalRendererResolved: ({ effective, reason }) => {
          terminalRendererRef.current = effective;
          if (reason === 'unsupported') {
            setTerminalRendererRetryPending(false);
            setTerminalRendererFallback(true);
          }
        },
        onError: (error) => {
          if (error instanceof MobileConnectionUnstableError) {
            // The bridge has stopped dialling; promising a reconnect would be a
            // lie, and the 重新连接 button below is the way back.
            setPairingRequired(false);
            setBridgeError(error.message);
          } else if (error instanceof MobileConnectFailureError) {
            // The dial failed before it opened. It will retry, but the user is
            // the only one who can fix a phone that is off the network.
            setPairingRequired(false);
            setBridgeError(error.message);
          } else if (error instanceof IdentityAccessError) {
            setPairingRequired(error.code === 'identity_missing');
            setBridgeError(error.message);
          } else if (error.message === 'desktop identity verification failed') {
            setPairingRequired(true);
            setBridgeError('电脑身份已变化，请重新配对。');
          } else {
            setPairingRequired(false);
            setBridgeError('安全连接异常，正在重新连接。');
          }
        },
      },
    });
  }
  bridge.current.setTerminalRenderer(effectiveTerminalRenderer);
  const pairingClientRef = useRef<PairingClient | null>(null);
  pairingClientRef.current ??= new PairingClient({ identity, profileStore });
  const pairingClient = pairingClientRef.current;

  forgetPairingRef.current = async (message) => {
    setUnpairPending(true);
    setUnpairError(null);
    const cleared = await localUnpairCoordinator.run({
      disconnect: () => {
        bridge.current?.forgetProfile();
        pairingClient.cancel();
      },
      clearProfile: async () => {
        // First, so a later step failing cannot leave terminal content behind.
        lastScreenStore.clear();
        await profileStore.clear();
        await resumeStore.clear();
      },
      clearRuntime: () => {
        clearOwnershipConfirmTimer();
        clearRefresh('idle');
        createdTerminalReconciler.stop();
        createdRoomReconciler.stop();
        closedTerminalReconciler.stop();
        ownershipReconciler.stop();
        ownershipRequestRef.current = null;
        carryControlTargetRef.current = null;
        createdTerminalRef.current = null;
        createdRoomRef.current = null;
        closedTerminalRef.current = null;
        closedPanelIdsRef.current.clear();
        pendingSurfaceCreateRef.current = null;
        pendingSurfaceCloseRef.current = null;
        if (pendingRoomSendRef.current !== null) {
          clearPendingRoomMessage(pendingRoomSendRef.current);
          pendingRoomSendRef.current = null;
        }
        roomSendAmbiguousRef.current = false;
        terminalWriteConfirmation.release();
        terminalWriteAmbiguousRef.current = false;
        attachedPanelIdRef.current = null;
        setWorkspaceFilesSupported(false);
        setWorkspaceFilesNeedDesktopUpdate(false);
        roomImageTransfer.cancelForDisconnect();
        terminalImageTransfer.cancelForDisconnect();
        workspaceFileTransport.cancelForDisconnect();
        clearRoomComposerImages();
        clearTerminalComposerImage();
        terminalPanelsRef.current = [];
        roomPanelsRef.current = [];
        roomCacheRef.current.clear();
        terminalDraftSubmission.clear();
        setRoomView({ roomCapability: null, messages: [], omittedMessages: 0 });
        terminalRecovery.clear();
        payloadRejection.reset();
        terminalTranscripts.clear();
        terminalGridStore.clear();
        setNativeGridPresentation(null);
        terminalGeometryGuard.clear();
        terminalSwap.reset();
        syncTerminalSwapStatus();
        terminalRef.current?.replace('');
        setPairingOpen(false);
        setPairingRequired(false);
        surfaceCreateOperation.cancel();
        setSurfaceCreateError(null);
        surfaceCloseOperation.cancel();
        composerSendOperation.cancel();
        setRoomImageViewer({ open: false, uri: null, pending: false, error: null });
        setBridgeError(message);
        dispatch({ type: 'unpaired' });
        commitRouteEvent({ type: 'reset' });
        settleResume();
        resumeTargetRef.current = null;
        setResumeTarget(null);
        lastScreenStore.clear();
        lastScreenFingerprintRef.current = null;
        setLastScreen(null);
        setDesktopKey(null);
      },
    });
    setUnpairPending(false);
    if (!cleared) {
      const detail = '本机配对资料删除失败，请重试。';
      setUnpairError(detail);
      setBridgeError(detail);
    }
  };

  useEffect(() => {
    if (NATIVE_GRID_DEMO || STORE_SHOT !== null) {
      setPreferencesReady(true);
      return;
    }
    let active = true;
    void preferencesStore.load().then((stored) => {
      if (!active) return;
      setPreferences(stored);
      setPreferencesReady(true);
      setPreferencesError(null);
    }).catch(() => {
      if (!active) return;
      setPreferencesReady(false);
      setPreferencesError('本机设置读取失败，请重新打开 Connect。');
    });
    return () => { active = false; };
  }, [preferencesStore]);

  useEffect(() => {
    if (DEMO_BUILD) {
      settleResume();
      setResumeLoaded(true);
      return;
    }
    let active = true;
    void resumeStore.load().then((stored) => {
      if (!active) return;
      resumeTargetRef.current = stored;
      setResumeTarget(stored);
      setResumeLoaded(true);
      if (stored === null) settleResume();
    }).catch(() => {
      if (!active) return;
      setResumeLoaded(true);
      settleResume();
    });
    return () => { active = false; };
  }, [resumeStore]);

  useEffect(() => {
    if (DEMO_BUILD) return;
    let active = true;
    void profileStore.loadWithStatus().then(({ profile: stored, cleanupReason }) => {
      if (!active) return;
      if (stored === null) {
        lastScreenStore.clear();
        if (cleanupReason === 'unsupported_address') {
          setPairingRequired(true);
          setBridgeError('配对资料中的地址不是 Connect 支持的私网地址，请重新配对。');
        }
        return;
      }
      dispatch({ type: 'paired', deviceName: `Mac · ${stored.host}` });
      setDesktopKey(desktopKeyOf(stored));
      setRelayProfile(stored.relay ?? null);
      // Saved against another pairing: it can never be shown, so it is not kept.
      const saved = lastScreenStore.load();
      if (saved !== null && saved.desktopKey !== desktopKeyOf(stored)) {
        lastScreenStore.clear();
        setLastScreen(null);
      }
      bridge.current?.connect(stored);
      if (AppState.currentState === 'background') bridge.current?.suspend();
    });
    return () => {
      active = false;
      clearOwnershipConfirmTimer();
      paintDeadline.clear();
      clearRefresh('idle');
      terminalWriteConfirmation.release();
      createdTerminalReconciler.stop();
      createdRoomReconciler.stop();
      closedTerminalReconciler.stop();
      ownershipReconciler.stop();
      bridge.current?.disconnect();
      pairingClient.cancel();
      cleanupPreparedRoomImages(roomComposerImagesRef.current.images);
    };
  }, [
    closedTerminalReconciler,
    createdTerminalReconciler,
    createdRoomReconciler,
    ownershipReconciler,
    pairingClient,
    profileStore,
  ]);

  useEffect(() => {
    if (!shouldApplyMobileResumeTarget({
      applied: resumeAppliedRef.current,
      catalogReady,
      connection: state.connection,
      loaded: resumeLoaded,
      target: resumeTarget,
    })) return;
    const resolved = resolveMobileResumeTarget(
      resumeTarget!,
      state.workspaces,
      state.panels,
    );
    settleResume();
    if (resolved.outcome === 'exact' && resolved.panelId !== null) setResumedPanelId(resolved.panelId);
    else setLastScreenRetired(true);
    commitRouteEvent({ type: 'restore', route: resolved.route });
    if (resolved.panelId !== null) {
      terminalDraftSubmission.update(resolved.panelId, resolved.draft);
      dispatch({
        type: 'panel_selected',
        panelId: resolved.panelId,
        draft: resolved.draft,
      });
    }
    dispatch({ type: 'draft_changed', draft: resolved.draft });
  }, [
    catalogReady,
    resumeLoaded,
    resumeTarget,
    state.connection,
    state.panels,
    state.workspaces,
    terminalDraftSubmission,
  ]);

  useEffect(() => {
    if (!resumeLoaded || !resumeAppliedRef.current) return;
    if (route.kind !== 'root' && !catalogReady) return;
    const target = describeMobileResumeTarget(
      route,
      state.workspaces,
      state.panels,
      state.draft,
    );
    if (target === null) return;
    resumeTargetRef.current = target;
    const timer = setTimeout(() => {
      if (resumeTargetRef.current !== target) return;
      void resumeStore.save(target).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [
    catalogReady,
    resumeLoaded,
    resumeStore,
    route,
    state.draft,
    state.panels,
    state.workspaces,
  ]);

  useEffect(() => {
    if (DEMO_BUILD) return;
    let previous = AppState.currentState;
    const backgroundConnection = new BackgroundConnectionCoordinator({
      bridge: bridge.current!,
    });
    const subscription = AppState.addEventListener('change', (next) => {
      if (shouldBackgroundMobileConnection(next)) {
        if (previous === 'active') {
          try {
            performanceStoreRef.current?.flush();
          } catch {
            // Performance diagnostics do not block suspension.
          }
          if (resumeLoadedRef.current && resumeAppliedRef.current) {
            const target = describeMobileResumeTarget(
              routeRef.current,
              stateRef.current.workspaces,
              stateRef.current.panels,
              stateRef.current.draft,
            );
            if (target !== null) {
              resumeTargetRef.current = target;
              void resumeStore.save(target).catch(() => {});
            }
          }
          saveLastScreenRef.current();
        }
        backgroundConnection.background();
      } else if (next === 'active' && previous !== 'active') {
        backgroundConnection.foreground();
      }
      previous = next;
    });
    return () => {
      try {
        performanceStoreRef.current?.flush();
      } catch {
        // Performance diagnostics do not block unmount cleanup.
      }
      subscription.remove();
      backgroundConnection.release();
    };
  }, [resumeStore]);

  useEffect(() => {
    const pending = roomComposerImagesRef.current;
    if (pending.roomCapability === null || pending.roomCapability === state.activePanelId) return;
    roomImagePickRequestRef.current += 1;
    cleanupPreparedRoomImages(pending.images);
    const empty = { roomCapability: null, images: [] as PreparedRoomImage[] };
    roomComposerImagesRef.current = empty;
    setRoomComposerImages(empty);
    setRoomImagePickPending(false);
  }, [state.activePanelId]);

  useEffect(() => {
    if (process.env.EXPO_PUBLIC_CONNECT_NATIVE_GRID_DEMO === '1' || STORE_SHOT !== null) return;
    setTerminalRendererFallback(false);
    attachedPanelIdRef.current = null;
    terminalSwap.reset();
    syncTerminalSwapStatus();
    setNativeGridPresentation(null);
    terminalGridStore.clear();
  }, [terminalGridStore, terminalSwap]);

  useEffect(() => {
    if (
      state.isDemo
      || STORE_SHOT !== null
      || route.kind !== 'session'
      || state.connection !== 'online'
      || state.activePanelId === null
    ) return;
    const activePanel = state.panels.find((panel) => panel.panelId === state.activePanelId);
    if (activePanel?.kind === 'collaboration') {
      attachedPanelIdRef.current = null;
      terminalSwap.reset();
      syncTerminalSwapStatus();
      showRoom(activePanel.panelId);
      void bridge.current?.send({
        kind: 'attachRoom',
        roomCapability: activePanel.panelId,
      }).catch(() => setBridgeError('协作房间加载失败，请刷新后重试。'));
      return;
    }
    const panelId = state.activePanelId;
    const swap = terminalSwap.snapshot();
    if (
      swap.targetPanelId === panelId
      && (swap.phase === 'preparing' || swap.phase === 'painting')
    ) return;
    if (
      attachedPanelIdRef.current === panelId
      && swap.phase === 'idle'
      && swap.presentedPanelId === panelId
    ) return;
    if (terminalRecovery.isBlocked(panelId)) {
      const operationId = createMobileRequestId();
      beginTerminalSwap(panelId, operationId, true);
      failTerminalSwap(panelId, operationId);
      setBridgeError(
        terminalRecovery.blockedDetail(panelId) ?? TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE,
      );
      return;
    }
    if (!terminalRecovery.beginAutomatic(panelId)) {
      // An attach for this panel is already in flight. Still re-point the swap
      // at it, so the frozen frame on screen is this panel's own last frame
      // rather than whichever panel was open before it.
      beginTerminalSwap(panelId, createMobileRequestId());
      return;
    }
    const snapshot = terminalTranscripts.snapshot(panelId);
    const operationId = createMobileRequestId();
    beginTerminalSwap(panelId, operationId);
    attachedPanelIdRef.current = null;
    void bridge.current?.attach(panelId, snapshot === null, operationId)
      .then(() => {
        if (
          stateRef.current.connection !== 'online'
          || stateRef.current.activePanelId !== panelId
        ) return;
        attachedPanelIdRef.current = panelId;
      })
      .catch(() => {
        terminalRecovery.fail(panelId);
        failTerminalSwap(panelId, operationId);
        if (carryControlTargetRef.current === panelId) {
          carryControlTargetRef.current = null;
        }
        if (stateRef.current.activePanelId === panelId) {
          setBridgeError('终端附着失败，请刷新后重试。');
        }
      });
  }, [
    state.activePanelId,
    state.connection,
    state.isDemo,
    state.panels,
    route.kind,
    configuredTerminalRenderer,
    terminalTranscripts,
  ]);

  useEffect(() => {
    if (
      route.kind !== 'session'
      ||
      state.connection !== 'online'
      || state.ownership !== 'reconciling'
      || state.activePanelId === null
      || state.panels.find((panel) => panel.panelId === state.activePanelId)?.kind === 'collaboration'
    ) {
      ownershipReconciler.stop();
      return;
    }
    const panelId = state.activePanelId;
    ownershipReconciler.start(
      () => {
        if (
          stateRef.current.connection !== 'online'
          || stateRef.current.ownership !== 'reconciling'
          || stateRef.current.activePanelId !== panelId
        ) return;
        void bridge.current?.queryOwnership(panelId).catch(() => {
          if (stateRef.current.activePanelId === panelId) {
            setBridgeError('控制权状态刷新失败，请检查连接。');
          }
        });
      },
      () => {
        if (
          stateRef.current.connection === 'online'
          && stateRef.current.ownership === 'reconciling'
          && stateRef.current.activePanelId === panelId
        ) {
          setBridgeError(
            terminalRecovery.isBlocked(panelId)
              ? terminalRecovery.blockedDetail(panelId) ?? TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE
              : '控制权状态未能确认，请刷新后重试。',
          );
        }
      },
      ownershipReconcileDelayMs(bridge.current?.roundTripEstimateMs() ?? null),
    );
    return () => ownershipReconciler.stop();
  }, [
    ownershipReconciler,
    state.activePanelId,
    state.connection,
    state.ownership,
    state.panels,
    route.kind,
  ]);

  const paired = (next: PairedDesktopProfile): void => {
    setBridgeError(null);
    lastScreenStore.clear();
    lastScreenFingerprintRef.current = null;
    setLastScreen(null);
    setDesktopKey(desktopKeyOf(next));
    setPairingRequired(false);
    setUnpairError(null);
    terminalTranscripts.clear();
    terminalGridStore.clear();
    setNativeGridPresentation(null);
    // Dropping the presentation without releasing the swap strands an in-flight
    // paint: nothing can ever report it, and the header spins for good.
    terminalSwap.reset();
    syncTerminalSwapStatus();
    terminalGeometryGuard.clear();
    terminalRecovery.clear();
    payloadRejection.reset();
    clearOwnershipConfirmTimer();
    createdTerminalReconciler.stop();
    createdRoomReconciler.stop();
    closedTerminalReconciler.stop();
    ownershipReconciler.stop();
    ownershipRequestRef.current = null;
    carryControlTargetRef.current = null;
    createdTerminalRef.current = null;
    createdRoomRef.current = null;
    closedTerminalRef.current = null;
    closedPanelIdsRef.current.clear();
    pendingSurfaceCloseRef.current = null;
    roomImageTransfer.cancelForDisconnect();
    terminalImageTransfer.cancelForDisconnect();
    workspaceFileTransport.cancelForDisconnect();
    clearRoomComposerImages();
    clearTerminalComposerImage();
    if (pendingRoomSendRef.current !== null) {
      clearPendingRoomMessage(pendingRoomSendRef.current);
      pendingRoomSendRef.current = null;
      finishDraftSubmission('ambiguous');
    }
    roomSendAmbiguousRef.current = false;
    if (terminalWriteConfirmation.release()) {
      finishDraftSubmission('ambiguous');
    }
    terminalWriteAmbiguousRef.current = false;
    surfaceCloseOperation.cancel();
    setCatalogReady(false);
    settleResume();
    resumeTargetRef.current = null;
    setResumeTarget(null);
    void resumeStore.clear();
    commitRouteEvent({ type: 'reset' });
    dispatch({ type: 'paired', deviceName: `Mac · ${next.host}` });
    bridge.current?.connect(next);
  };

  const requestIntent = (intent: MobileIntent): void => {
    const snapshot = stateRef.current;
    if (snapshot.isDemo) {
      dispatch({ type: 'intent_requested', intent });
      return;
    }
    if (intent === 'takeover' || intent === 'return_to_desktop') {
      const panelId = snapshot.activePanelId;
      const epoch = snapshot.ownershipEpoch;
      if (panelId === null || epoch === null || ownershipRequestRef.current !== null) return;
      setBridgeError(null);
      const requestId = beginOwnershipRequest(intent, panelId, 'user');
      const command = intent === 'takeover'
        ? { kind: 'takeover' as const, requestId, panelId }
        : { kind: 'returnToDesktop' as const, requestId, panelId, epoch };
      performanceTrace.record(requestId, 'ownership', 'request_sent');
      void bridge.current?.send(command).catch(() => {
        failOwnershipRequest(intent, requestId, '控制权请求未能确认，请检查连接。');
      });
      return;
    }
    if (intent === 'reconnect') {
      dispatch({ type: 'intent_requested', intent });
      void profileStore.loadWithStatus().then(({ profile: stored, cleanupReason }) => {
        if (stored === null) {
          if (cleanupReason === 'unsupported_address') {
            throw new Error('配对资料中的地址不是 Connect 支持的私网地址，请重新配对。');
          }
          throw new Error('配对资料不可用，请重新配对。');
        }
        bridge.current?.connect(stored);
      }).catch((error: unknown) => {
        setPairingRequired(true);
        setBridgeError(error instanceof Error
          ? error.message
          : '配对资料不可用，请重新配对。');
        dispatch({
          type: 'intent_failed',
          intent: 'reconnect',
          category: 'action_required',
        });
      });
      return;
    }
    if (intent === 'send') {
      const activePanel = snapshot.panels.find((panel) => panel.panelId === snapshot.activePanelId);
      if (activePanel?.kind === 'collaboration') {
        const images = roomComposerImagesRef.current.roomCapability === activePanel.panelId
          ? roomComposerImagesRef.current.images
          : [];
        if (
          snapshot.connection !== 'online'
          || !snapshot.canControlInput
          || pendingRoomSendRef.current !== null
          || roomImageTransfer.busy
          || roomImagePickPending
        ) return;
        const draft = terminalDraftSubmission.begin(activePanel.panelId, images.length > 0);
        if (draft === null) return;
        if (images.length > 0) {
          const submittedImages = [...images];
          const operationId = createMobileRequestId();
          roomSendAmbiguousRef.current = false;
          composerSendOperation.begin(operationId);
          dispatch({ type: 'draft_changed', draft: '' });
          void roomImageTransfer.uploadAndCommit({
            roomCapability: activePanel.panelId,
            text: draft,
            images: submittedImages,
          }).then(() => {
            if (
              roomComposerImagesRef.current.roomCapability === activePanel.panelId
              && roomComposerImagesRef.current.images.every(
                (image, index) => image.id === submittedImages[index]?.id,
              )
            ) clearRoomComposerImages();
            roomSendAmbiguousRef.current = false;
            finishDraftSubmission('completed', operationId);
            setBridgeError(null);
          }).catch((error: unknown) => {
            roomSendAmbiguousRef.current = error instanceof RoomImageCommitAmbiguousError;
            finishDraftSubmission(
              error instanceof RoomImageCommitAmbiguousError ? 'ambiguous' : 'failed',
              operationId,
            );
            setBridgeError(
              error instanceof RoomImageCommitAmbiguousError
                ? '图片消息结果未能确认，请先查看房间记录。'
                : '图片消息发送失败，正文和图片已保留。',
            );
          });
          return;
        }
        const requestId = createMobileRequestId();
        const localMessage = createPendingRoomMessage(requestId, draft);
        const pending = {
          requestId,
          roomCapability: activePanel.panelId,
          text: draft,
          localMessageId: localMessage.id,
        };
        performanceTrace.record(requestId, 'room_send', 'started');
        pendingRoomSendRef.current = pending;
        roomSendAmbiguousRef.current = false;
        composerSendOperation.begin(requestId);
        dispatch({ type: 'draft_changed', draft: '' });
        const cached = roomCacheRef.current.get(activePanel.panelId)
          ?? { messages: [], omittedMessages: 0 };
        const merged = mergeBoundedRoomMessages(cached.messages, [localMessage]);
        storeRoom(
          activePanel.panelId,
          merged.messages,
          cached.omittedMessages + merged.omittedMessages,
        );
        performanceTrace.record(requestId, 'room_send', 'local_feedback');
        performanceTrace.record(requestId, 'room_send', 'intent_committed');
        void bridge.current?.send({
          kind: 'sendRoom',
          requestId,
          roomCapability: pending.roomCapability,
          text: pending.text,
        }).then(() => {
          performanceTrace.record(requestId, 'room_send', 'request_sent');
        }).catch(() => {
          if (pendingRoomSendRef.current !== pending) return;
          clearPendingRoomMessage(pending);
          pendingRoomSendRef.current = null;
          performanceTrace.record(requestId, 'room_send', 'failed', 'ambiguous');
          roomSendAmbiguousRef.current = true;
          finishDraftSubmission('ambiguous', requestId);
          setBridgeError('协作消息结果未能确认，请先查看房间记录。');
        });
        return;
      }
      if (
        snapshot.activePanelId === null
        || snapshot.ownershipEpoch === null
        || snapshot.connection !== 'online'
        || snapshot.ownership !== 'mobile_owned'
        || !snapshot.canControlInput
        || snapshot.panelExited
      ) return;
      const terminalImage = terminalComposerImageRef.current.panelId === snapshot.activePanelId
        ? terminalComposerImageRef.current.image
        : null;
      if (
        terminalImage !== null
        && (
          (activePanel?.kind !== 'claude' && activePanel?.kind !== 'codex')
          || terminalImageTransfer.busy
          || terminalImagePickPending
        )
      ) return;
      const draft = terminalDraftSubmission.begin(snapshot.activePanelId, terminalImage !== null);
      if (draft === null) return;
      dispatch({ type: 'draft_changed', draft: '' });
      if (terminalImage !== null) {
        const submittedImage = terminalImage;
        const operationId = createMobileRequestId();
        terminalWriteAmbiguousRef.current = false;
        composerSendOperation.begin(operationId);
        void terminalImageTransfer.uploadAndCommit({
          panelId: snapshot.activePanelId,
          epoch: snapshot.ownershipEpoch,
          text: draft,
          image: submittedImage,
        }).then(() => {
          if (terminalComposerImageRef.current.image?.id === submittedImage.id) {
            clearTerminalComposerImage();
          }
          terminalWriteAmbiguousRef.current = false;
          finishDraftSubmission('completed', operationId);
          setBridgeError(null);
        }).catch((error: unknown) => {
          const ambiguous = error instanceof TerminalImageCommitAmbiguousError;
          terminalWriteAmbiguousRef.current = ambiguous;
          if (ambiguous && terminalComposerImageRef.current.image?.id === submittedImage.id) {
            clearTerminalComposerImage();
          }
          finishDraftSubmission(ambiguous ? 'ambiguous' : 'failed', operationId);
          setBridgeError(ambiguous
            ? '图片消息结果未能确认，请先查看终端输出；为避免重复，图片没有自动重发。'
            : '图片消息发送失败，正文和图片已保留。');
        });
        return;
      }
      sendTerminalDraft(`${draft}\r`);
      return;
    }
    if (intent === 'stop') {
      sendTerminalData('\x03');
      return;
    }
    setBridgeError('当前终端不支持这项结构化操作。');
  };

  const sendTerminalDraft = (data: string): void => {
    const snapshot = stateRef.current;
    const panelId = snapshot.activePanelId;
    const epoch = snapshot.ownershipEpoch;
    const currentBridge = bridge.current;
    const requestId = createMobileRequestId();
    composerSendOperation.begin(requestId);
    if (
      panelId === null
      || epoch === null
      || snapshot.connection !== 'online'
      || snapshot.ownership !== 'mobile_owned'
      || !snapshot.canControlInput
      || snapshot.panelExited
      || currentBridge === null
      || terminalWriteConfirmation.busy
    ) {
      finishDraftSubmission('failed', requestId);
      return;
    }
    performanceTrace.record(requestId, 'terminal_render', 'started');
    performanceTrace.record(requestId, 'terminal_render', 'local_feedback');
    performanceTrace.record(requestId, 'terminal_render', 'intent_committed');
    if (!terminalWriteConfirmation.begin(requestId, panelId, () => {
      if (pendingTerminalRenderRef.current?.requestId === requestId) {
        pendingTerminalRenderRef.current = null;
      }
      performanceTrace.record(requestId, 'terminal_render', 'failed', 'ambiguous');
      terminalWriteAmbiguousRef.current = true;
      finishDraftSubmission('ambiguous', requestId);
      setBridgeError('终端输入结果未能确认，请先查看终端输出。');
    })) {
      finishDraftSubmission('failed', requestId);
      return;
    }
    terminalWriteAmbiguousRef.current = false;
    pendingTerminalRenderRef.current = { requestId, panelId, ptyObserved: false };
    performanceTrace.record(requestId, 'terminal_render', 'request_sent');
    void currentBridge.sendWrite(panelId, data, epoch, requestId).catch(() => {
      if (!terminalWriteConfirmation.reject(requestId)) return;
      if (pendingTerminalRenderRef.current?.requestId === requestId) {
        pendingTerminalRenderRef.current = null;
      }
      performanceTrace.record(requestId, 'terminal_render', 'failed', 'ambiguous');
      terminalWriteAmbiguousRef.current = true;
      finishDraftSubmission('ambiguous', requestId);
      setBridgeError('终端输入结果未能确认，请连接后先查看终端输出。');
    });
  };

  const sendTerminalData = (data: string, paste = false): void => {
    const snapshot = stateRef.current;
    const panelId = snapshot.activePanelId;
    const epoch = snapshot.ownershipEpoch;
    if (
      panelId === null
      || epoch === null
      || snapshot.connection !== 'online'
      || snapshot.ownership !== 'mobile_owned'
      || !snapshot.canControlInput
      || snapshot.panelExited
    ) return;
    void terminalInputQueue.enqueue(panelId, async () => {
      const currentBridge = bridge.current;
      if (currentBridge === null) throw new Error('bridge unavailable');
      await currentBridge.sendWrite(panelId, data, epoch, undefined, paste);
    }).catch(() => {
      setBridgeError('终端输入发送失败，请检查连接与控制权。');
    });
  };

  const pasteTerminalData = (): void => {
    void Clipboard.getStringAsync().then((data) => {
      if (data.length > 0) sendTerminalData(data, true);
    }).catch(() => {
      setBridgeError(t('读取系统剪贴板失败，请重试。'));
    });
  };

  // Opening a terminal takes its input when the user asked for that (ADR-003 §11,
  // 2026-09-29). Armed once per opening — entering it, or bringing the App back
  // to it — and spent by the first takeover, so a Mac that takes the terminal
  // back is not fought over while the phone still shows it.
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  /** Bumped only by a real return from the background (see appStateReopen). */
  const [foregroundGeneration, setForegroundGeneration] = useState(0);
  useEffect(() => {
    let wasBackgrounded = false;
    const subscription = AppState.addEventListener('change', (next) => {
      setAppActive(next === 'active');
      const reopen = appStateReopen(wasBackgrounded, next);
      wasBackgrounded = reopen.wasBackgrounded;
      if (reopen.reopened) {
        setForegroundGeneration((generation) => generation + 1);
        // A day may have passed in the background: the promise is about the
        // disk, so the expiry check runs now, not at the next cold start.
        setLastScreen(lastScreenStore.load());
      }
    });
    return () => subscription.remove();
  }, [lastScreenStore]);
  useEffect(() => {
    if (state.connection !== 'online') setPanelStatuses({});
  }, [state.connection]);
  // Seeing a finished panel here is seeing it on the desktop too (user 2026-10-17):
  // a new result on the panel in front of the user is marked read at once.
  const activePanelStatus = state.activePanelId === null ? undefined : panelStatuses[state.activePanelId];
  useEffect(() => {
    const current = bridge.current;
    const panelId = state.activePanelId;
    if (current === null || panelId === null || !shouldMarkPanelRead({
      onSessionRoute: route.kind === 'session',
      appActive,
      connection: state.connection,
      activePanelId: panelId,
      status: activePanelStatus,
      desktopSupportsPanelStates: current.supportsPanelStates,
    })) return;
    void current.send({ kind: 'markPanelRead', requestId: createMobileRequestId(), panelId }).catch(() => undefined);
  }, [activePanelStatus, appActive, route.kind, state.activePanelId, state.connection]);
  const [autoTakeoverArm, setAutoTakeoverArm] = useState<string | null>(null);
  useEffect(() => {
    setAutoTakeoverArm(route.kind === 'session' ? state.activePanelId : null);
  }, [foregroundGeneration, route.kind, state.activePanelId]);
  useEffect(() => {
    if (autoTakeoverArmSpent(state, autoTakeoverArm)) {
      setAutoTakeoverArm(null);
      return;
    }
    if (!shouldAutoTakeover(state, {
      // Not before the preference is read: the default must not stand in for
      // a user who switched it off.
      enabled: preferencesReady && preferences.autoTakeover !== false,
      armedPanelId: autoTakeoverArm,
      onSessionRoute: route.kind === 'session',
      appActive,
    })) return;
    const panelId = autoTakeoverArm!;
    setAutoTakeoverArm(null);
    requestAutomaticTakeover(panelId, '自动接管未能确认，请点「接管」重试。');
  }, [appActive, autoTakeoverArm, preferences.autoTakeover, preferencesReady, route.kind, state]);

  // Keeps the terminal on screen as the next cold start's first picture. Only
  // what the user has actually seen live is saved, and only for a terminal.
  const saveLastScreenRef = useRef<() => void>(() => {});
  /** What was last written, so an unchanged screen is not re-serialized every tick. */
  const lastScreenFingerprintRef = useRef<string | null>(null);
  saveLastScreenRef.current = () => {
    const key = desktopKeyRef.current;
    const snapshot = stateRef.current;
    const panelId = snapshot.activePanelId;
    if (key === null || panelId === null || routeRef.current.kind !== 'session') return;
    if (terminalSwap.snapshot().presentedPanelId !== panelId) return;
    const target = describeMobileResumeTarget(
      routeRef.current,
      snapshot.workspaces,
      snapshot.panels,
      snapshot.draft,
    );
    if (target?.kind !== 'session' || target.surfaceKind === 'collaboration') return;
    const identity = {
      desktopKey: key,
      workspaceLabel: target.workspaceLabel,
      surfaceLabel: target.surfaceLabel,
      surfaceKind: target.surfaceKind,
    };
    const nowMs = Date.now();
    const frame = terminalRendererRef.current === 'native-grid'
      ? terminalGridStore.get(panelId)
      : null;
    const transcript = frame === null ? terminalTranscripts.snapshot(panelId) : null;
    const next = frame !== null
      ? lastScreenFromGrid(identity, frame, nowMs)
      : transcript !== null ? lastScreenFromTranscript(identity, transcript, nowMs) : null;
    if (next === null) {
      // Too large to keep whole: an older picture of it would pass for the last one.
      lastScreenFingerprintRef.current = null;
      lastScreenStore.clear();
      return;
    }
    const fingerprint = next.screen.kind === 'grid'
      ? `${panelId}:grid:${next.screen.frame.revision}`
      : `${panelId}:bytes:${next.screen.segments.length}:${transcript?.data.length ?? 0}`;
    if (fingerprint === lastScreenFingerprintRef.current) return;
    lastScreenFingerprintRef.current = fingerprint;
    lastScreenStore.save(next);
  };
  // Opening any other terminal ends the saved screen's run: it stood for one.
  useEffect(() => {
    if (resumedPanelId !== null && state.activePanelId !== null && state.activePanelId !== resumedPanelId) {
      setLastScreenRetired(true);
    }
  }, [resumedPanelId, state.activePanelId]);
  useEffect(() => {
    if (route.kind !== 'session' || state.connection !== 'online') return;
    const timer = setInterval(() => saveLastScreenRef.current(), LAST_SCREEN_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [route.kind, state.connection]);

  // Geometry handover: only a phone that actually holds input may reshape the
  // shared PTY, and only after the layout settles. See terminalGeometryHandover
  // for the policy and its history.
  const keyboardVisibleRef = useRef(false);
  const terminalViewRef = useRef(effectiveTerminalView);
  terminalViewRef.current = effectiveTerminalView;
  const noteKeyboardVisibility = useCallback((visible: boolean): void => {
    keyboardVisibleRef.current = visible;
  }, []);
  const [ptyGeometry] = useState(() => createPtyGeometryHandover({
    settleMs: PTY_GEOMETRY_SETTLE_MS,
    target: () => {
      const snapshot = stateRef.current;
      if (snapshot.activePanelId === null || snapshot.ownershipEpoch === null) return null;
      return {
        panelId: snapshot.activePanelId,
        epoch: snapshot.ownershipEpoch,
        state: {
          connection: snapshot.connection,
          ownership: snapshot.ownership,
          canControlInput: snapshot.canControlInput,
          keyboardVisible: keyboardVisibleRef.current,
          isDemo: snapshot.isDemo,
          presentation: terminalViewRef.current,
          followsPhone: preferencesRef.current.takeoverFollowsPhone !== false,
        },
      };
    },
    send: async (panelId, geometry) => {
      await bridge.current?.resize(panelId, geometry.cols, geometry.rows);
    },
  }));
  const [phoneViewportCols, setPhoneViewportCols] = useState<number | null>(null);
  const reportTerminalViewport = useCallback((cols: number, rows: number, transient?: boolean): void => {
    ptyGeometry.report({ cols, rows }, transient);
    if (!transient) setPhoneViewportCols(cols);
  }, [ptyGeometry]);
  useEffect(() => {
    if (state.ownership === 'mobile_owned') ptyGeometry.settle();
  }, [
    effectiveTerminalView,
    preferences.takeoverFollowsPhone,
    ptyGeometry,
    state.activePanelId,
    state.ownership,
    state.ownershipEpoch,
  ]);
  ptyGeometryRef.current = ptyGeometry;

  // One opening = this terminal, this foreground, this connection. Until the
  // phone-width frames land, the desktop-width ones stay hidden behind the last
  // screen or a loading state (MOBILE-NATIVE-RENDERER-ONLY-01, user 2026-10-17).
  const onlineGenerationRef = useRef({ connection: state.connection, generation: 0 });
  if (onlineGenerationRef.current.connection !== state.connection) {
    onlineGenerationRef.current = {
      connection: state.connection,
      generation: onlineGenerationRef.current.generation + (state.connection === 'online' ? 1 : 0),
    };
  }
  const openingKey = route.kind === 'session' && state.activePanelId !== null
    ? `${state.activePanelId}:${foregroundGeneration}:${onlineGenerationRef.current.generation}`
    : null;
  const [openingReveal, setOpeningReveal] = useState<{ key: string | null; firstFrameAt: number | null; revealed: boolean }>(
    { key: null, firstFrameAt: null, revealed: false },
  );
  const opening = openingReveal.key === openingKey
    ? openingReveal
    : { key: openingKey, firstFrameAt: null, revealed: false };
  const liveFrameCols = nativeGridPresentation?.frame.panelId === state.activePanelId
    ? nativeGridPresentation.frame.cols
    : null;
  const activeTerminalPanel = state.panels.find((panel) => panel.panelId === state.activePanelId);
  const openingExpectsPhoneGeometry = expectsPhoneGeometry({
    connection: state.connection,
    isTerminal: activeTerminalPanel !== undefined && activeTerminalPanel.kind !== 'collaboration',
    isDemo: state.isDemo,
    byteStream: terminalRendererFallback,
    ownership: state.ownership,
    ownershipKnown: state.ownershipEpoch !== null,
    canControlInput: state.canControlInput,
    followsPhone: preferences.takeoverFollowsPhone !== false,
    autoTakeover: preferencesReady && preferences.autoTakeover !== false,
  });
  const [openingClock, setOpeningClock] = useState(0);
  const openingSettledNow = liveFrameCols !== null && opening.firstFrameAt !== null && terminalOpeningSettled({
    expectsPhoneGeometry: openingExpectsPhoneGeometry,
    phoneCols: phoneViewportCols,
    frameCols: liveFrameCols,
    sinceFirstFrameMs: Date.now() - opening.firstFrameAt,
  });
  const terminalSettling = openingKey !== null && liveFrameCols !== null && !opening.revealed && !openingSettledNow;
  const terminalSettlingRef = useRef(terminalSettling);
  terminalSettlingRef.current = terminalSettling;
  const retireLastScreenOnRevealRef = useRef(false);
  useEffect(() => {
    if (openingKey === null || liveFrameCols === null) return;
    if (opening.firstFrameAt === null) {
      setOpeningReveal({ key: openingKey, firstFrameAt: Date.now(), revealed: false });
      return;
    }
    if (opening.revealed) return;
    if (openingSettledNow) {
      setOpeningReveal({ ...opening, revealed: true });
      if (retireLastScreenOnRevealRef.current) {
        retireLastScreenOnRevealRef.current = false;
        setLastScreenRetired(true);
      }
      return;
    }
    // Re-evaluate when the settle window closes, even if no frame arrives.
    const timer = setTimeout(
      () => setOpeningClock((tick) => tick + 1),
      Math.max(0, opening.firstFrameAt + TERMINAL_OPENING_SETTLE_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [liveFrameCols, opening, openingClock, openingKey, openingSettledNow]);
  useEffect(() => {
    const show = KeyboardEvents.addListener('keyboardWillShow', () => ptyGeometry.keyboard(true));
    const hide = KeyboardEvents.addListener('keyboardWillHide', () => ptyGeometry.keyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [ptyGeometry]);
  useEffect(() => () => ptyGeometry.dispose(), [ptyGeometry]);

  // A wheel is a mouse event like any other here: the same ownership epoch,
  // write scope and online checks decide it, and the desktop still forwards it
  // only while the authoritative mirror reports mouse tracking enabled.
  const sendTerminalMouse = (input: {
    action: 'press' | 'release' | 'wheel-up' | 'wheel-down';
    button: 0;
    column: number;
    row: number;
  }): void => {
    const snapshot = stateRef.current;
    const panelId = snapshot.activePanelId;
    const epoch = snapshot.ownershipEpoch;
    if (
      panelId === null
      || epoch === null
      || snapshot.connection !== 'online'
      || snapshot.ownership !== 'mobile_owned'
      || !snapshot.canControlInput
      || snapshot.panelExited
    ) return;
    void terminalInputQueue.enqueue(panelId, async () => {
      const currentBridge = bridge.current;
      if (currentBridge === null) throw new Error('bridge unavailable');
      await currentBridge.sendMouse(panelId, input, epoch);
    }).catch(() => {
      setBridgeError(t('终端鼠标事件发送失败，请检查连接与控制权。'));
    });
  };

  const sendTerminalKey = (key: TerminalKeyName, modifiers: TerminalKeyModifiers): void => {
    const snapshot = stateRef.current;
    const panelId = snapshot.activePanelId;
    const epoch = snapshot.ownershipEpoch;
    if (
      panelId === null
      || epoch === null
      || snapshot.connection !== 'online'
      || snapshot.ownership !== 'mobile_owned'
      || !snapshot.canControlInput
      || snapshot.panelExited
    ) return;
    void terminalInputQueue.enqueue(panelId, async () => {
      const currentBridge = bridge.current;
      if (currentBridge === null) throw new Error('bridge unavailable');
      await currentBridge.sendKey(panelId, key, epoch, modifiers);
    }).catch(() => {
      setBridgeError(t('终端按键发送失败，请检查连接与控制权。'));
    });
  };

  const finishDraftSubmission = (
    phase: Extract<OperationPhase, 'completed' | 'failed' | 'ambiguous'>,
    operationId = composerSendOperation.current().operationId,
  ): void => {
    if (operationId === null || !composerSendOperation.advance(operationId, phase)) return;
    const settlement = terminalDraftSubmission.settle(phase === 'completed');
    if (
      settlement !== null
      && settlement.restoredDraft !== null
      && settlement.targetId === stateRef.current.activePanelId
    ) {
      dispatch({ type: 'draft_changed', draft: settlement.restoredDraft });
    }
  };

  const submitDraft = (draft: string): void => {
    const targetId = stateRef.current.activePanelId;
    if (targetId === null) return;
    terminalDraftSubmission.update(targetId, draft);
    requestIntent('send');
  };

  const pickImagesForRoom = (): void => {
    const snapshot = stateRef.current;
    const panel = snapshot.panels.find((candidate) => candidate.panelId === snapshot.activePanelId);
    if (
      panel?.kind !== 'collaboration'
      || snapshot.connection !== 'online'
      || !snapshot.canControlInput
      || composerSendPending
      || roomImagePickPending
    ) return;
    const existing = roomComposerImagesRef.current.roomCapability === panel.panelId
      ? roomComposerImagesRef.current.images
      : [];
    const request = ++roomImagePickRequestRef.current;
    setRoomImagePickPending(true);
    void pickRoomImages(existing).then((picked) => {
      if (
        roomImagePickRequestRef.current !== request
        || stateRef.current.activePanelId !== panel.panelId
      ) {
        cleanupPreparedRoomImages(picked);
        return;
      }
      const next = { roomCapability: panel.panelId, images: [...existing, ...picked] };
      roomComposerImagesRef.current = next;
      setRoomComposerImages(next);
      setBridgeError(null);
    }).catch((error: unknown) => {
      setBridgeError(error instanceof Error ? error.message : '图片选择失败，请重试。');
    }).finally(() => {
      if (roomImagePickRequestRef.current === request) setRoomImagePickPending(false);
    });
  };

  const removeRoomComposerImage = (id: string): void => {
    if (composerSendPending) return;
    const current = roomComposerImagesRef.current;
    const removed = current.images.find((image) => image.id === id);
    if (removed === undefined) return;
    cleanupPreparedRoomImages([removed]);
    const remaining = current.images.filter((image) => image.id !== id);
    const next = {
      roomCapability: remaining.length === 0 ? null : current.roomCapability,
      images: remaining,
    };
    roomComposerImagesRef.current = next;
    setRoomComposerImages(next);
  };

  const pickImageForTerminal = (): void => {
    const snapshot = stateRef.current;
    const panel = snapshot.panels.find((candidate) => candidate.panelId === snapshot.activePanelId);
    if (
      (panel?.kind !== 'claude' && panel?.kind !== 'codex')
      || snapshot.connection !== 'online'
      || snapshot.ownership !== 'mobile_owned'
      || !snapshot.canControlInput
      || composerSendPending
      || terminalImageTransfer.busy
      || terminalImagePickPending
    ) return;
    const request = ++terminalImagePickRequestRef.current;
    setTerminalImagePickPending(true);
    void pickTerminalImage().then((picked) => {
      if (picked === null) return;
      if (
        terminalImagePickRequestRef.current !== request
        || stateRef.current.activePanelId !== panel.panelId
      ) {
        cleanupPreparedRoomImages([picked]);
        return;
      }
      const previous = terminalComposerImageRef.current.image;
      if (previous !== null) cleanupPreparedRoomImages([previous]);
      const next = { panelId: panel.panelId, image: picked };
      terminalComposerImageRef.current = next;
      setTerminalComposerImage(next);
      setBridgeError(null);
    }).catch((error: unknown) => {
      setBridgeError(error instanceof Error ? error.message : '图片选择失败，请重试。');
    }).finally(() => {
      if (terminalImagePickRequestRef.current === request) setTerminalImagePickPending(false);
    });
  };

  const removeTerminalComposerImage = (id: string): void => {
    if (composerSendPending || terminalComposerImageRef.current.image?.id !== id) return;
    clearTerminalComposerImage();
  };

  const openRoomImage = (messageId: string, imageIndex: number): void => {
    const roomCapability = stateRef.current.activePanelId;
    if (roomCapability === null || roomImageTransfer.busy) return;
    const request = ++roomImageViewerRequestRef.current;
    setRoomImageViewer({ open: true, uri: null, pending: true, error: null });
    void roomImageTransfer.download({ roomCapability, messageId, imageIndex }).then((image) => {
      if (roomImageViewerRequestRef.current !== request) return;
      setRoomImageViewer({ open: true, uri: image.dataUri, pending: false, error: null });
    }).catch(() => {
      if (roomImageViewerRequestRef.current !== request) return;
      setRoomImageViewer({ open: true, uri: null, pending: false, error: '图片加载失败，请重试。' });
    });
  };

  const startRefresh = (): void => {
    if (refreshRef.current !== null) return;
    if (!operationPresentation(surfaceCloseOperation.current()).busy) {
      surfaceCloseOperation.cancel();
    }
    const snapshot = stateRef.current;
    const currentBridge = bridge.current;
    if (snapshot.connection !== 'online' || currentBridge === null) {
      const requestId = createMobileRequestId();
      refreshOperation.begin(requestId);
      refreshOperation.advance(requestId, 'failed');
      setBridgeError('项目与会话刷新失败，请检查连接。');
      return;
    }

    const requestId = createMobileRequestId();
    const activePanel = snapshot.panels.find((panel) => panel.panelId === snapshot.activePanelId);
    const refreshTerminal = shouldRefreshSessionTerminal(route, activePanel)
      && snapshot.activePanelId !== null
      && terminalRecovery.beginManual(snapshot.activePanelId);
    const pending = new Set<RefreshPart>(['workspaces', 'panels', 'rooms']);
    const timer = setTimeout(() => {
      if (refreshRef.current?.requestId !== requestId) return;
      refreshRef.current = null;
      if (refreshTerminal && snapshot.activePanelId !== null) {
        terminalRecovery.fail(snapshot.activePanelId);
        failTerminalSwap(snapshot.activePanelId, requestId);
      }
      refreshOperation.advance(requestId, 'failed');
      setBridgeError('项目与会话刷新超时，请检查连接后重试。');
    }, REFRESH_CONFIRM_TIMEOUT_MS);
    refreshRef.current = { requestId, pending, timer };
    refreshOperation.begin(requestId);
    setBridgeError(null);

    const sends: Promise<unknown>[] = [
      currentBridge.send({ kind: 'listWorkspaces', requestId }),
      currentBridge.send({ kind: 'listPanels', requestId }),
      currentBridge.send({ kind: 'listRooms', requestId }),
    ];
    if (refreshTerminal && snapshot.activePanelId !== null) {
      beginTerminalSwap(snapshot.activePanelId, requestId, true);
      sends.push(currentBridge.attach(snapshot.activePanelId, true, requestId));
    }
    void Promise.all(sends).catch(() => {
      if (refreshRef.current?.requestId !== requestId) return;
      if (refreshTerminal && snapshot.activePanelId !== null) {
        terminalRecovery.fail(snapshot.activePanelId);
        failTerminalSwap(snapshot.activePanelId, requestId);
      }
      clearRefresh('failed', requestId);
      setBridgeError('项目与会话刷新失败，请检查连接。');
    });
  };

  const selectPanel = (panelId: string, workspaceCapability?: string): void => {
    const target = resolvePanelSelection(
      stateRef.current.panels,
      panelId,
      workspaceCapability,
    );
    if (target === null) {
      setBridgeError('目标会话已失效，请刷新后重试。');
      return;
    }
    if (
      panelId !== stateRef.current.activePanelId
      && (roomImageTransfer.activity === 'uploading' || roomImageTransfer.activity === 'committing')
    ) {
      setBridgeError('图片消息正在发送，请稍候。');
      return;
    }
    if (
      panelId !== stateRef.current.activePanelId
      && terminalImageTransfer.busy
    ) {
      setBridgeError('图片消息正在发送，请稍候。');
      return;
    }
    if (panelId !== stateRef.current.activePanelId) {
      roomImagePickRequestRef.current += 1;
      setRoomImagePickPending(false);
      roomImageViewerRequestRef.current += 1;
      if (roomImageTransfer.activity === 'downloading') roomImageTransfer.cancelCurrent();
      setRoomImageViewer({ open: false, uri: null, pending: false, error: null });
      terminalImagePickRequestRef.current += 1;
      setTerminalImagePickPending(false);
    }
    const pendingOwnership = ownershipRequestRef.current;
    if (pendingOwnership !== null) {
      clearOwnershipConfirmTimer();
      ownershipRequestRef.current = null;
      dispatch({
        type: 'intent_failed',
        intent: pendingOwnership.intent,
        category: 'ambiguous',
      });
    }
    carryControlTargetRef.current = shouldCarryMobileControl(
      stateRef.current,
      panelId,
    ) ? panelId : null;
    if (target?.kind === 'collaboration') {
      setTerminalSwapStatus('idle');
      showRoom(panelId);
      setBridgeError(null);
    } else {
      if (panelId !== stateRef.current.activePanelId) setTerminalSwapStatus('pending');
      setBridgeError(
        terminalRecovery.isBlocked(panelId)
          ? terminalRecovery.blockedDetail(panelId)
            ?? TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE
          : null,
      );
    }
    if (
      target.workspaceCapability !== undefined
      && (
        routeRef.current.kind !== 'session'
        || routeRef.current.panelId !== panelId
        || routeRef.current.workspaceCapability !== target.workspaceCapability
      )
    ) {
      navigate({
        type: 'open_session',
        workspaceCapability: target.workspaceCapability,
        panelId,
      }, [
        ...(routeRef.current.kind !== 'root'
          && routeRef.current.workspaceCapability !== target.workspaceCapability
          ? ['workspace_switch' as const]
          : []),
        ...(target.kind === 'collaboration' ? [] : ['terminal_switch' as const]),
      ]);
    }
    dispatch({
      type: 'panel_selected',
      panelId,
      draft: terminalDraftSubmission.currentDraft(panelId),
    });
  };

  const createSurface = (workspaceCapability: string, surfaceKind: SurfaceKind): void => {
    const currentOperation = surfaceCreateOperation.current();
    if (
      pendingSurfaceCreateRef.current !== null
      || operationPresentation(currentOperation).busy
      || currentOperation.phase === 'ambiguous'
      || stateRef.current.connection !== 'online'
      || !stateRef.current.canControlInput
    ) return;
    createdTerminalReconciler.stop();
    createdRoomReconciler.stop();
    createdTerminalRef.current = null;
    createdRoomRef.current = null;
    const requestId = createMobileRequestId();
    performanceTrace.record(requestId, 'surface_create', 'started');
    performanceTrace.record(requestId, 'surface_create', 'local_feedback');
    performanceTrace.record(requestId, 'surface_create', 'intent_committed');
    pendingSurfaceCreateRef.current = {
      requestId,
      workspaceCapability,
      surfaceKind,
      existingPanelIds: new Set(
        stateRef.current.panels.map((panel) => panel.panelId),
      ),
    };
    setSurfaceCreateError(null);
    surfaceCreateOperation.begin(requestId);
    performanceTrace.record(requestId, 'surface_create', 'request_sent');
    void bridge.current?.send({
      kind: 'createSurface',
      requestId,
      workspaceCapability,
      surfaceKind,
    }).catch(() => {
      if (pendingSurfaceCreateRef.current?.requestId !== requestId) return;
      pendingSurfaceCreateRef.current = null;
      performanceTrace.record(requestId, 'surface_create', 'failed', 'retryable');
      surfaceCreateOperation.advance(requestId, 'failed');
      setSurfaceCreateError('创建请求发送失败，请检查连接。');
    });
  };

  const dismissSurfaceCreate = (): void => {
    if (!operationPresentation(surfaceCreateOperation.current()).busy) {
      surfaceCreateOperation.cancel();
      setSurfaceCreateError(null);
    }
  };

  const updatePreferences = (patch: MobilePreferencesPatch): void => {
    if (!preferencesReady) return;
    preferencesWriteCountRef.current += 1;
    setPreferencesPending(true);
    setPreferencesError(null);
    void preferencesStore.update(patch).then((next) => {
      setPreferences(next);
    }).catch(() => {
      setPreferencesError('本机设置保存失败，请重试。');
    }).finally(() => {
      preferencesWriteCountRef.current = Math.max(0, preferencesWriteCountRef.current - 1);
      if (preferencesWriteCountRef.current === 0) setPreferencesPending(false);
    });
  };

  const updateCollaborationAvatar = (): void => {
    const snapshot = stateRef.current;
    const workspaceCapability = collaborationProfileWorkspace(snapshot.workspaces)
      ?.workspaceCapability;
    if (
      workspaceCapability === undefined
      || snapshot.connection !== 'online'
      || !snapshot.canControlInput
      || collaborationAvatarOperationRef.current !== null
    ) return;
    collaborationAvatarOperationRef.current = { requestId: null, workspaceCapability };
    setCollaborationAvatarPending(true);
    setCollaborationAvatarError(null);
    void pickCollaborationAvatar().then((avatar) => {
      if (avatar === null) {
        collaborationAvatarOperationRef.current = null;
        setCollaborationAvatarPending(false);
        return;
      }
      if (
        stateRef.current.connection !== 'online'
        || !stateRef.current.canControlInput
        || !stateRef.current.workspaces.some(
          (workspace) => workspace.workspaceCapability === workspaceCapability,
        )
      ) throw new Error('workspace authority changed');
      const requestId = createMobileRequestId();
      collaborationAvatarOperationRef.current = { requestId, workspaceCapability };
      return bridge.current?.send({
        kind: 'setCollaborationAvatar',
        requestId,
        workspaceCapability,
        avatar,
      });
    }).catch(() => {
      collaborationAvatarOperationRef.current = null;
      setCollaborationAvatarPending(false);
      setCollaborationAvatarError('头像更新失败，请重试。');
    });
  };

  const lastScreenInput = {
    lastScreen,
    retired: lastScreenRetired,
    desktopKey,
    resumeTarget,
    resumeSettled,
    resumedPanelId,
    nowMs: Date.now(),
  };
  // Cold start, resuming a terminal: its last screen stands in for 首页 until
  // the live session route can be restored.
  const resumePreview = resumePreviewScreen({
    ...lastScreenInput,
    onHomeRoute: route.kind === 'root' && route.tab === 'home',
  });
  // Once resumed, it stays over that terminal until the first live paint.
  const sessionLastScreenValue = route.kind === 'session'
    ? sessionLastScreen({ ...lastScreenInput, activePanelId: state.activePanelId })
    : null;
  const routeCatalogPresentation = presentMobileRouteCatalog(
    routeCatalogSnapshotRef.current,
    route,
    state.workspaces,
    state.panels,
    state.isDemo || (catalogReady && !operationPresentation(refreshStatus).busy),
  );
  useLayoutEffect(() => {
    routeCatalogSnapshotRef.current = routeCatalogPresentation.snapshot;
  }, [routeCatalogPresentation.snapshot]);
  const routeContentReady = routeCatalogPresentation.contentReady;
  const routeWorkspace = routeCatalogPresentation.snapshot?.workspace ?? null;
  const routePanels = routeCatalogPresentation.snapshot?.panels ?? [];
  // —— IPAD-01：iPad 平板壳（同一份状态与处理函数，只换排版）——
  const windowSize = useWindowDimensions();
  const tabletLayout = isTabletLayout(windowSize.width)
    && state.connection !== 'unpaired'
    && resumePreview === null;
  const [tabletSidebarVisible, setTabletSidebarVisible] = useState(true);
  const [tabletSidebarMode, setTabletSidebarMode] = useState<TabletSidebarMode>(
    STORE_SHOT?.scene === 'files' ? 'files' : 'projects',
  );
  const [tabletFiles, setTabletFiles] = useState<TabletFileTab[]>(() => (STORE_SHOT?.scene === 'files'
    ? [{ workspaceCapability: STORE_SHOT_WORKSPACE, workspaceLabel: INITIAL.workspaces[0]!.label, subPath: STORE_SHOT_OPEN_FILE }]
    : []));
  /** 按 label + 路径记住当前文件：capability 轮换后标签被重映射，这里无需跟着改。 */
  const [tabletActiveFileRef, setTabletActiveFileRef] = useState<Pick<TabletFileTab, 'workspaceLabel' | 'subPath'> | null>(
    STORE_SHOT?.scene === 'files'
      ? { workspaceLabel: INITIAL.workspaces[0]!.label, subPath: STORE_SHOT_OPEN_FILE }
      : null,
  );
  // 截图模式「新建会话」场景：iPad 的新建入口是主区弹层（手机版在项目页里），首帧直接打开。
  const [tabletCreateCapability, setTabletCreateCapability] = useState<string | null>(
    STORE_SHOT?.scene === 'create' ? STORE_SHOT_WORKSPACE : null,
  );
  const tabletWorkspaceRef = useRef<string | null>(null);
  if (route.kind !== 'root') tabletWorkspaceRef.current = route.workspaceCapability;
  const tabletWorkspace = state.workspaces.find(
    (workspace) => workspace.workspaceCapability === tabletWorkspaceRef.current,
  ) ?? null;
  const tabletWorkspacePanels = tabletWorkspace === null
    ? []
    : state.panels.filter((panel) => panel.workspaceCapability === tabletWorkspace.workspaceCapability);
  const tabletWorkspaceFiles = tabletFiles.filter(
    (tab) => tab.workspaceCapability === tabletWorkspace?.workspaceCapability,
  );
  const tabletActiveFile = tabletActiveFileRef === null
    ? null
    : tabletFiles.find((tab) => (
      tab.workspaceLabel === tabletActiveFileRef.workspaceLabel && tab.subPath === tabletActiveFileRef.subPath
    )) ?? null;
  const tabletActiveFileKey = tabletActiveFile === null ? null : tabletFileTabKey(tabletActiveFile);
  const tabletCanCreate = state.connection === 'online' && state.canControlInput && !state.isDemo;
  useEffect(() => {
    setTabletFiles((previous) => {
      const next = remapTabletFileTabs(previous, state.workspaces);
      const unchanged = next.length === previous.length
        && next.every((tab, index) => tabletFileTabKey(tab) === tabletFileTabKey(previous[index]!));
      return unchanged ? previous : next;
    });
  }, [state.workspaces]);
  useEffect(() => {
    if (surfaceCreateStatus === 'completed') setTabletCreateCapability(null);
  }, [surfaceCreateStatus]);
  useEffect(() => {
    const live = new Set(state.workspaces.map((workspace) => workspace.workspaceCapability));
    // 新建面板打开期间若项目 capability 轮换，旧值会让面板静默回落到列表第一个项目：直接关掉。
    setTabletCreateCapability((capability) => (capability !== null && !live.has(capability) ? null : capability));
    if (STORE_SHOT === null && state.connection === 'online') pruneWorkspaceFileTreeStores(workspaceFileTransport, live);
  }, [state.connection, state.workspaces, workspaceFileTransport]);
  const openTabletFile = (workspaceCapability: string, subPath: string): void => {
    const workspace = state.workspaces.find((candidate) => candidate.workspaceCapability === workspaceCapability);
    if (workspace === undefined) return;
    const tab: TabletFileTab = { workspaceCapability, workspaceLabel: workspace.label, subPath };
    const key = tabletFileTabKey(tab);
    setTabletFiles((previous) => (
      previous.some((candidate) => tabletFileTabKey(candidate) === key) ? previous : [...previous, tab]
    ));
    setTabletActiveFileRef({ workspaceLabel: workspace.label, subPath });
  };
  const closeTabletFiles = (predicate: (tab: TabletFileTab) => boolean): void => {
    setTabletFiles((previous) => previous.filter((tab) => !predicate(tab)));
    if (tabletActiveFile !== null && predicate(tabletActiveFile)) setTabletActiveFileRef(null);
  };

  const sessionState = useMemo(() => route.kind === 'session'
    ? {
        ...state,
        panels: routePanels,
        hasActivePanel: routePanels.some((panel) => panel.panelId === state.activePanelId),
      }
    : state, [route.kind, routePanels, state]);

  useEffect(() => {
    if (route.kind === 'root') return;
    if (state.connection === 'unpaired') {
      commitRouteEvent({ type: 'reset' });
      return;
    }
    if (state.connection !== 'online' || !catalogReady) return;
    if (
      operationPresentation(refreshStatus).busy
      || refreshStatus === 'failed'
      || refreshStatus === 'ambiguous'
    ) return;
    const resolved = resolveMobileRouteRevalidation(
      route,
      resumeTargetRef.current,
      state.workspaces,
      state.panels,
    );
    if (resolved === null) return;
    commitRouteEvent({ type: 'restore', route: resolved.route });
    if (resolved.panelId !== null) {
      terminalDraftSubmission.update(resolved.panelId, resolved.draft);
      dispatch({
        type: 'panel_selected',
        panelId: resolved.panelId,
        draft: resolved.draft,
      });
    }
    dispatch({ type: 'draft_changed', draft: resolved.draft });
  }, [
    catalogReady,
    refreshStatus,
    route,
    state.connection,
    state.panels,
    state.workspaces,
    terminalDraftSubmission,
  ]);

  const retryNativeTerminal = (): void => {
    const panelId = stateRef.current.activePanelId;
    const currentBridge = bridge.current;
    if (
      panelId === null
      || currentBridge === null
      || stateRef.current.connection !== 'online'
      || terminalRendererRetryPending
    ) return;
    setBridgeError(null);
    setTerminalRendererRetryPending(true);
    const retryGeneration = terminalRendererRetryGenerationRef.current + 1;
    terminalRendererRetryGenerationRef.current = retryGeneration;
    void currentBridge.refreshTerminalGridSupport().then((supported) => {
      if (terminalRendererRetryGenerationRef.current !== retryGeneration) return;
      if (
        !supported
        || stateRef.current.connection !== 'online'
        || stateRef.current.activePanelId !== panelId
      ) {
        setTerminalRendererRetryPending(false);
        setTerminalRendererFallback(true);
        terminalRendererRef.current = 'legacy-webview';
        currentBridge.setTerminalRenderer('legacy-webview');
        if (!supported) setBridgeError(t('原生终端能力未能确认，请检查连接后重试。'));
        return;
      }
      terminalRendererRef.current = 'native-grid';
      currentBridge.setTerminalRenderer('native-grid');
      terminalRecovery.complete(panelId);
      terminalGridStore.remove(panelId);
      attachedPanelIdRef.current = null;
      const operationId = createMobileRequestId();
      beginTerminalSwap(panelId, operationId, true);
      void currentBridge.attach(panelId, true, operationId, 'native-grid').catch(() => {
        if (terminalRendererRetryGenerationRef.current !== retryGeneration) return;
        setTerminalRendererRetryPending(false);
        setTerminalRendererFallback(true);
        terminalRendererRef.current = 'legacy-webview';
        currentBridge.setTerminalRenderer('legacy-webview');
        failTerminalSwap(panelId, operationId);
        setBridgeError(t('原生终端不可用，兼容模式恢复失败，请刷新重试。'));
      });
    }).catch(() => {
      if (terminalRendererRetryGenerationRef.current !== retryGeneration) return;
      setTerminalRendererRetryPending(false);
      setTerminalRendererFallback(true);
      terminalRendererRef.current = 'legacy-webview';
      currentBridge.setTerminalRenderer('legacy-webview');
      setBridgeError(t('原生终端能力未能确认，请检查连接后重试。'));
    });
  };

  const updateRelayProfile = async (config: { url: string; apiKey: string } | null): Promise<void> => {
    const current = await profileStore.load();
    if (!current) throw new Error('no paired desktop');
    const next = config === null
      ? await profileStore.setRelay(null)
      : await profileStore.updateRelayEndpoint(
          config,
          await relayTicketForDevice(current.deviceId, current.desktopIdentityPubKey),
        );
    setRelayProfile(next.relay ?? null);
    bridge.current?.connect(next);
  };

  const routeView = (
      <RouteTransitionView
        contentReady={routeContentReady}
        operationId={pendingNavigationRef.current
          ?? (appStartOperationRef.current?.stable === false
            ? appStartOperationRef.current.operationId
            : null)}
        onFirstPaint={(operationId) => {
          if (pendingNavigationRef.current === operationId) {
            performanceTrace.record(operationId, 'navigation', 'first_paint');
            for (const operation of pendingNavigationRelatedRef.current) {
              performanceTrace.record(operationId, operation, 'first_paint');
            }
          }
          if (appStartOperationRef.current?.operationId === operationId) {
            performanceTrace.record(operationId, 'app_start', 'first_paint');
          }
        }}
        onStableFrame={(operationId) => {
          if (pendingNavigationRef.current === operationId) {
            performanceTrace.record(operationId, 'navigation', 'stable_frame');
            for (const operation of pendingNavigationRelatedRef.current) {
              performanceTrace.record(operationId, operation, 'stable_frame');
            }
            pendingNavigationRef.current = null;
            pendingNavigationRelatedRef.current = [];
          }
          if (appStartOperationRef.current?.operationId === operationId) {
            performanceTrace.record(operationId, 'app_start', 'stable_frame');
            appStartOperationRef.current.stable = true;
          }
        }}
        route={route}
        transition={navigation.transition}
      >
      {route.kind === 'root' ? (
        <>
          {resumePreview !== null ? (
            <ResumePreviewScreen
              connection={presentedConnection}
              connectionDetail={bridgeError}
              fontFamily={preferences.terminalFont ?? 'menlo'}
              onBack={() => {
                // Going back gives up the resume, not just the picture.
                settleResume();
                setLastScreenRetired(true);
              }}
              screen={resumePreview}
              theme={theme}
            />
          ) : route.tab === 'home' ? (
            tabletLayout ? (
              <TabletEmptyState theme={theme} title={t('选择一个会话，或在左侧打开文件')} />
            ) : (
              <HomeScreen
                panelStatuses={panelStatuses}
                state={state}
                presentedConnection={presentedConnection}
                connectionDetail={bridgeError}
                theme={theme}
                refreshStatus={refreshStatus}
                onPair={() => setPairingOpen(true)}
                onProject={(workspaceCapability) => {
                  navigate(
                    { type: 'open_project', workspaceCapability },
                    ['workspace_switch'],
                  );
                }}
                onRefresh={startRefresh}
                publicAppInfo={MOBILE_PUBLIC_APP_INFO}
                onOpenPublicLink={openMobilePublicLink}
                onOpenSettings={() => navigate({ type: 'select_tab', tab: 'settings' })}
              />
            )
          ) : (
            <SettingsScreen
              state={state}
              presentedConnection={presentedConnection}
              theme={theme}
              preferences={preferences}
              preferencesReady={preferencesReady}
              preferencesPending={preferencesPending}
              preferencesError={preferencesError}
              collaborationAvatar={collaborationAvatar}
              avatarPending={collaborationAvatarPending}
              avatarError={collaborationAvatarError}
              unpairPending={unpairPending}
              unpairError={unpairError}
              onPreferencesChange={updatePreferences}
              onAvatarPick={updateCollaborationAvatar}
              onUnpair={() => {
                void forgetPairingRef.current?.(null);
              }}
              relay={relayProfile}
              onRelayChange={updateRelayProfile}
              publicAppInfo={MOBILE_PUBLIC_APP_INFO}
              onOpenPublicLink={openMobilePublicLink}
              onBack={() => navigate({ type: 'back' })}
            />
          )}
        </>
      ) : route.kind === 'project' && routeWorkspace !== null ? (
        tabletLayout ? (
          <TabletEmptyState
            actionLabel={tabletCanCreate ? t('新建会话') : undefined}
            onAction={() => setTabletCreateCapability(routeWorkspace.workspaceCapability)}
            theme={theme}
            title={routeWorkspace.label}
          />
        ) : (
          <ProjectScreen
            panelStatuses={panelStatuses}
            state={state}
            presentedConnection={presentedConnection}
            theme={theme}
            workspace={routeWorkspace}
            panels={routePanels}
            refreshStatus={refreshStatus}
            surfaceCreateStatus={surfaceCreateStatus}
            surfaceCreateError={surfaceCreateError}
            onBack={() => navigate({ type: 'back' })}
            onSession={(panelId) => {
              selectPanel(panelId, routeWorkspace.workspaceCapability);
            }}
            onRefresh={startRefresh}
            onCreate={createSurface}
            onCreateDismiss={dismissSurfaceCreate}
            initialCreateSheetOpen={STORE_SHOT?.scene === 'create'}
            initialSection={STORE_SHOT?.scene === 'files' ? 'files' : undefined}
            fileTransport={workspaceFileTransport}
            filesSupported={workspaceFilesSupported}
            filesNeedDesktopUpdate={workspaceFilesNeedDesktopUpdate}
          />
        )
      ) : route.kind === 'session' ? (
        <SessionScreen
          panelStatuses={panelStatuses}
          state={sessionState}
          presentedConnection={presentedConnection}
          theme={theme}
          connectionDetail={bridgeError}
        pairingRequired={pairingRequired}
        surfaceCreateStatus={surfaceCreateStatus}
        surfaceCreateError={surfaceCreateError}
        surfaceCloseStatus={surfaceCloseStatus}
        composerSendStatus={composerSendStatus}
        refreshStatus={refreshStatus}
        terminalSwapStatus={terminalSwapStatus}
        terminalFont={preferences.terminalFont ?? 'menlo'}
        lastScreen={sessionLastScreenValue}
        terminalSettling={terminalSettling}
        terminalProbe={NATIVE_GRID_DEMO}
        terminalShortcuts={preferences.terminalShortcuts}
        terminalQueueDepth={terminalQueueDepth}
        nativeGridPresentation={nativeGridPresentation}
        onDraftChange={(draft) => {
          if (!operationPresentation(composerSendOperation.current()).busy) {
            composerSendOperation.cancel();
          }
          if (roomSendAmbiguousRef.current) {
            roomSendAmbiguousRef.current = false;
            setBridgeError(null);
          }
          if (terminalWriteAmbiguousRef.current) {
            terminalWriteAmbiguousRef.current = false;
            setBridgeError(null);
          }
          const targetId = stateRef.current.activePanelId;
          if (targetId !== null) terminalDraftSubmission.update(targetId, draft);
          dispatch({ type: 'draft_changed', draft });
        }}
        onDraftSubmit={submitDraft}
        onIntent={requestIntent}
        onTerminalRecoveryNeeded={() => {
          const panelId = stateRef.current.activePanelId;
          if (
            panelId === null
            || !terminalRecovery.beginAutomatic(panelId)
          ) return;
          terminalTranscripts.invalidate(panelId);
          const operationId = createMobileRequestId();
          beginTerminalSwap(panelId, operationId, true);
          void bridge.current?.attach(panelId, true, operationId).catch(() => {
            terminalRecovery.fail(panelId);
            failTerminalSwap(panelId, operationId);
            terminalRef.current?.reportRecoveryFailed();
            setBridgeError(t('终端画面恢复失败，请刷新后重试。'));
          });
        }}
        terminalRendererFallback={terminalRendererFallback}
        terminalRendererRetryPending={terminalRendererRetryPending}
        onTerminalRendererRetry={retryNativeTerminal}
        onTerminalPaint={(operationId) => {
          if (terminalSwap.painted(operationId) !== null) {
            // A live frame is on screen: the saved one has done its job — once
            // the opening settles; until then it is what the user sees.
            if (terminalSettlingRef.current) retireLastScreenOnRevealRef.current = true;
            else setLastScreenRetired(true);
            saveLastScreenRef.current();
            const panelId = terminalSwap.snapshot().presentedPanelId;
            const latest = panelId === null ? null : terminalTranscripts.snapshot(panelId);
            if (
              terminalRendererRef.current === 'legacy-webview'
              && latest !== null
            ) {
              terminalRef.current?.replace(latest.segments, {
                trimmedLines: latest.trimmedLines,
                lostLines: latest.lostLines,
                partialLoss: latest.partialLoss,
              });
            }
            syncTerminalSwapStatus();
          }
          const pending = pendingTerminalRenderRef.current;
          if (pending?.requestId !== operationId) return;
          pendingTerminalRenderRef.current = null;
          performanceTrace.record(
            operationId,
            'terminal_render',
            'webview_painted',
          );
          performanceTrace.record(
            operationId,
            'terminal_render',
            'completed',
            'ok',
          );
        }}
        onTerminalRenderStage={(operationId, stage) => {
          if (pendingTerminalRenderRef.current?.requestId !== operationId) return;
          performanceTrace.record(operationId, 'terminal_render', stage);
        }}
        onPair={() => setPairingOpen(true)}
        onBackToProject={() => navigate({ type: 'back' })}
        visibleWorkspaces={routeWorkspace === null ? [] : [routeWorkspace]}
        switcherPanels={state.panels}
        switcherWorkspaces={state.workspaces}
        onPanelSelect={selectPanel}
        onPanelsRefresh={startRefresh}
        onOwnershipReconcile={() => {
          const panelId = stateRef.current.activePanelId;
          if (
            panelId === null
            || stateRef.current.connection !== 'online'
            || stateRef.current.ownership !== 'reconciling'
          ) return;
          setBridgeError(null);
          void bridge.current?.queryOwnership(panelId).catch(() => {
            if (
              stateRef.current.activePanelId === panelId
              && stateRef.current.ownership === 'reconciling'
            ) setBridgeError(t('控制权状态刷新失败，请检查连接。'));
          });
        }}
        onSurfaceCreateDismiss={dismissSurfaceCreate}
        onSurfaceCreate={createSurface}
        onSurfaceClose={(panelId, epoch) => {
          if (
            pendingSurfaceCloseRef.current !== null
            || stateRef.current.connection !== 'online'
            || !stateRef.current.canControlInput
            || stateRef.current.activePanelId !== panelId
            || stateRef.current.ownershipEpoch !== epoch
          ) return false;
          const requestId = createMobileRequestId();
          performanceTrace.record(requestId, 'surface_close', 'started');
          pendingSurfaceCloseRef.current = { requestId, panelId, epoch };
          setBridgeError(null);
          surfaceCloseOperation.begin(requestId);
          performanceTrace.record(requestId, 'surface_close', 'local_feedback');
          performanceTrace.record(requestId, 'surface_close', 'intent_committed');
          performanceTrace.record(requestId, 'surface_close', 'request_sent');
          void bridge.current?.send({
            kind: 'closeSurface',
            requestId,
            panelId,
            epoch,
          }).catch(() => {
            if (pendingSurfaceCloseRef.current?.requestId !== requestId) return;
            performanceTrace.record(
              requestId,
              'surface_close',
              'failed',
              'retryable',
            );
            pendingSurfaceCloseRef.current = null;
            surfaceCloseOperation.advance(requestId, 'failed');
            setBridgeError(t('关闭请求发送失败，请检查连接。'));
          });
          return true;
        }}
        onTerminalInput={(data) => sendTerminalData(data)}
        onTerminalKey={sendTerminalKey}
        onTerminalPaste={pasteTerminalData}
        onTerminalMouse={sendTerminalMouse}
        onTerminalResize={reportTerminalViewport}
        onKeyboardVisibility={noteKeyboardVisibility}
        terminalRef={terminalRef}
        roomMessages={roomView.roomCapability === state.activePanelId
          ? roomView.messages
          : []}
        collaborationAvatar={collaborationAvatar}
        roomOmittedMessages={roomView.roomCapability === state.activePanelId
          ? roomView.omittedMessages
          : 0}
        roomComposerImages={roomComposerImages.roomCapability === state.activePanelId
          ? roomComposerImages.images
          : []}
        roomImagePickPending={roomImagePickPending}
        terminalComposerImages={
          terminalComposerImage.panelId === state.activePanelId
          && terminalComposerImage.image !== null
            ? [terminalComposerImage.image]
            : []
        }
        terminalImagePickPending={terminalImagePickPending}
        roomImageViewer={roomImageViewer}
        onRoomImagePick={pickImagesForRoom}
        onRoomImageRemove={removeRoomComposerImage}
        onTerminalImagePick={pickImageForTerminal}
        onTerminalImageRemove={removeTerminalComposerImage}
        onRoomImageOpen={openRoomImage}
        onRoomImageViewerClose={() => {
          roomImageViewerRequestRef.current += 1;
          if (roomImageViewer.pending) roomImageTransfer.cancelCurrent();
          setRoomImageViewer({ open: false, uri: null, pending: false, error: null });
        }}
      />
      ) : (
        <HomeScreen
          panelStatuses={panelStatuses}
          state={state}
          presentedConnection={presentedConnection}
          theme={theme}
          refreshStatus={refreshStatus}
          onPair={() => setPairingOpen(true)}
          onProject={(workspaceCapability) => {
            navigate(
              { type: 'open_project', workspaceCapability },
              ['workspace_switch'],
            );
          }}
          onRefresh={startRefresh}
          onOpenSettings={() => navigate({ type: 'select_tab', tab: 'settings' })}
        />
      )}
      </RouteTransitionView>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <ReducedMotionProvider>
            <KeyboardProvider preload={false}>
              <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
                <StatusBar
                  backgroundColor={theme.colors.bg}
                  barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
                />
                {tabletLayout ? (
                  <View style={styles.tabletRoot}>
                    {tabletSidebarVisible ? (
                      <TabletSidebar
                        panelStatuses={panelStatuses}
                        activeFileSubPath={tabletActiveFile?.subPath ?? null}
                        activePanelId={route.kind === 'session' ? route.panelId : null}
                        currentWorkspace={tabletWorkspace}
                        fileTransport={workspaceFileTransport}
                        filesSupported={workspaceFilesSupported}
                        filesNeedDesktopUpdate={workspaceFilesNeedDesktopUpdate}
                        mode={tabletSidebarMode}
                        onCreateSession={setTabletCreateCapability}
                        onFileRemoved={(workspaceCapability, subPath) => closeTabletFiles((tab) => (
                          tab.workspaceCapability === workspaceCapability
                          && (tab.subPath === subPath || tab.subPath.startsWith(`${subPath}/`))
                        ))}
                        onModeChange={setTabletSidebarMode}
                        onOpenFile={openTabletFile}
                        onOpenProject={(workspaceCapability) => {
                          setTabletActiveFileRef(null);
                          navigate({ type: 'open_project', workspaceCapability }, ['workspace_switch']);
                        }}
                        onOpenSession={(panelId, workspaceCapability) => {
                          setTabletActiveFileRef(null);
                          selectPanel(panelId, workspaceCapability);
                        }}
                        onOpenSettings={() => {
                          setTabletActiveFileRef(null);
                          navigate({ type: 'select_tab', tab: 'settings' });
                        }}
                        onRefresh={startRefresh}
                        panels={state.panels}
                        presentedConnection={presentedConnection}
                        refreshStatus={refreshStatus}
                        settingsActive={route.kind === 'root' && route.tab === 'settings' && tabletActiveFile === null}
                        state={state}
                        theme={theme}
                        width={tabletSidebarWidth(windowSize.width)}
                      />
                    ) : null}
                    <View style={styles.tabletMain}>
                      <SafeAreaView edges={['top', 'right']} style={{ backgroundColor: theme.colors.panel }}>
                        <TabletTabStrip
                          panelStatuses={panelStatuses}
                          online={state.connection === 'online'}
                          activeFileKey={tabletActiveFileKey}
                          activePanelId={route.kind === 'session' ? route.panelId : null}
                          canCreate={tabletCanCreate && tabletWorkspace !== null}
                          files={workspaceFilesSupported ? tabletWorkspaceFiles : []}
                          onCloseFile={(tab) => closeTabletFiles((candidate) => (
                            tabletFileTabKey(candidate) === tabletFileTabKey(tab)
                          ))}
                          onCreateSession={() => {
                            if (tabletWorkspace !== null) setTabletCreateCapability(tabletWorkspace.workspaceCapability);
                          }}
                          onSelectFile={(tab) => setTabletActiveFileRef({
                            workspaceLabel: tab.workspaceLabel,
                            subPath: tab.subPath,
                          })}
                          onSelectSession={(panel) => {
                            setTabletActiveFileRef(null);
                            selectPanel(panel.panelId, panel.workspaceCapability);
                          }}
                          onToggleSidebar={() => setTabletSidebarVisible((visible) => !visible)}
                          sessions={tabletWorkspacePanels}
                          sidebarVisible={tabletSidebarVisible}
                          theme={theme}
                        />
                      </SafeAreaView>
                      <View style={styles.tabletContent}>
                        <TabletContentArea sidebarVisible={tabletSidebarVisible}>
                          {routeView}
                          {tabletActiveFile !== null && workspaceFilesSupported ? (
                            <SafeAreaView
                              edges={['right', 'bottom']}
                              style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.bg }]}
                            >
                              <WorkspaceFileViewer
                                canWrite={tabletCanCreate}
                                chrome="pane"
                                documentKey={`${tabletActiveFile.workspaceLabel}:${tabletActiveFile.subPath}`}
                                key={`${tabletActiveFile.workspaceLabel}:${tabletActiveFile.subPath}`}
                                onClose={() => closeTabletFiles((tab) => (
                                  tabletFileTabKey(tab) === tabletFileTabKey(tabletActiveFile)
                                ))}
                                subPath={tabletActiveFile.subPath}
                                theme={theme}
                                transport={workspaceFileTransport}
                                workspaceCapability={tabletActiveFile.workspaceCapability}
                              />
                            </SafeAreaView>
                          ) : null}
                        </TabletContentArea>
                      </View>
                    </View>
                    <SurfaceCreateSheet
                      error={surfaceCreateError}
                      initialWorkspaceCapability={tabletCreateCapability}
                      onClose={() => {
                        setTabletCreateCapability(null);
                        dismissSurfaceCreate();
                      }}
                      onCreate={(workspaceCapability, kind) => createSurface(workspaceCapability, kind)}
                      open={tabletCreateCapability !== null}
                      status={surfaceCreateStatus}
                      theme={theme}
                      workspaces={state.workspaces}
                    />
                  </View>
                ) : routeView}
                <PairingFlow
                  client={pairingClient}
                  initialSas={STORE_SHOT?.scene === 'pair' ? STORE_SHOT_SAS : undefined}
                  onClose={() => setPairingOpen(false)}
                  onPaired={paired}
                  open={pairingOpen}
                  theme={theme}
                />
              </View>
            </KeyboardProvider>
          </ReducedMotionProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  tabletRoot: { flex: 1, flexDirection: 'row' },
  tabletMain: { flex: 1, minWidth: 0 },
  tabletContent: { flex: 1 },
});
