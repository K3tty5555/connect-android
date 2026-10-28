import { useEffect, useState } from 'react';
import type { MobilePanelStatus } from '../../../../src/shared/types';
import { PanelStatusLamp, lampTone, panelStatusLabel } from '../components/PanelStatusLamp';
import { FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, Plus } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  ConnectionState,
  SessionPanelSummary,
  SessionViewModel,
  SessionWorkspaceSummary,
  SurfaceKind,
} from '../domain/session';
import type { BrowserPanelEntry } from '../domain/browserMirrorSession';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { KindIcon } from '../components/KindIcon';
import { MotionPressable } from '../components/MotionPressable';
import {
  ProgressiveRefreshButton,
  type RefreshStatus,
} from '../components/ProgressiveRefreshButton';
import type { OperationPhase } from '../domain/operationPresentation';
import { useAndroidBack } from '../platform/useAndroidBack';
import { SurfaceCreateSheet } from '../components/SurfaceCreateSheet';
import { panelDisplayLabel } from '../domain/panelLabel';
import { SurfaceLifecyclePlaceholder } from '../components/SurfaceLifecyclePlaceholder';
import { t } from '../i18n';
import { useReducedMotion } from '../theme/reducedMotion';
import {
  SelectionIndicator,
  StableListExit,
  StableMotionRow,
  useStableListEntries,
} from '../components/StableMotionList';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { WorkspaceFilesPane } from '../components/files/WorkspaceFilesPane';
import { WorkspaceFileViewer } from '../components/files/WorkspaceFileViewer';
import type { WorkspaceFileTransport } from '../domain/workspaceFiles';

export type ProjectSection = 'sessions' | 'files';

/** 回到同一项目时停在上次的分段；按 label 记，重连轮换 capability 后仍对得上。 */
const lastSectionByWorkspace = new Map<string, ProjectSection>();

const NO_PANEL_STATUSES: Readonly<Record<string, MobilePanelStatus>> = {};

export function ProjectScreen({
  state,
  presentedConnection = state.connection,
  theme,
  workspace,
  panels,
  refreshStatus,
  surfaceCreateStatus,
  surfaceCreateError,
  onBack,
  onSession,
  onRefresh,
  onCreate,
  onCreateDismiss,
  initialCreateSheetOpen = false,
  fileTransport = null,
  filesSupported = false,
  filesNeedDesktopUpdate = false,
  initialSection,
  panelStatuses = NO_PANEL_STATUSES,
  browserPanels = [],
  webMirrorSupported = false,
  onBrowser,
}: {
  /** The desktop's lamp per panel; absent where the desktop does not offer it. */
  panelStatuses?: Readonly<Record<string, MobilePanelStatus>>;
  state: SessionViewModel;
  presentedConnection?: ConnectionState;
  theme: ConnectTheme;
  workspace: SessionWorkspaceSummary;
  panels: readonly SessionPanelSummary[];
  refreshStatus: RefreshStatus;
  surfaceCreateStatus: OperationPhase;
  surfaceCreateError: string | null;
  onBack(): void;
  onSession(panelId: string): void;
  onRefresh(): void;
  onCreate(workspaceCapability: string, kind: SurfaceKind): void;
  onCreateDismiss(): void;
  /** App Store screenshot scene only: the sheet is already open on arrival. */
  initialCreateSheetOpen?: boolean;
  /** ADR-003 §14：只有桌面声明 workspace-files-v1 时才出现「文件」分段。 */
  fileTransport?: WorkspaceFileTransport | null;
  filesSupported?: boolean;
  /** 桌面回答了探针但没有文件能力：仍显示「文件」分段，内容是一行「在电脑上更新后可用」。 */
  filesNeedDesktopUpdate?: boolean;
  /** App Store screenshot scene only. */
  initialSection?: ProjectSection;
  /** ADR-003 §19：桌面正在打开的网页面板；只在桌面声明 web-mirror-v1 时出现。 */
  browserPanels?: readonly BrowserPanelEntry[];
  webMirrorSupported?: boolean;
  onBrowser?(browserCapability: string): void;
}): React.ReactElement {
  const [createSheetOpen, setCreateSheetOpen] = useState(initialCreateSheetOpen);
  const filesAvailable = filesSupported && fileTransport !== null && !state.isDemo;
  const showFiles = filesAvailable || (filesNeedDesktopUpdate && !state.isDemo);
  const [section, setSection] = useState<ProjectSection>(
    () => initialSection ?? lastSectionByWorkspace.get(workspace.label) ?? 'sessions',
  );
  const [openFile, setOpenFile] = useState<string | null>(null);
  const activeSection: ProjectSection = showFiles ? section : 'sessions';
  const [pendingSurface, setPendingSurface] = useState<{
    workspaceCapability: string;
    kind: SurfaceKind;
  } | null>(null);
  const styles = createStyles(theme);
  const reducedMotion = useReducedMotion();
  const visibleBrowserPanels = webMirrorSupported ? browserPanels : [];
  const listEntries: ReadonlyArray<SessionPanelSummary | BrowserPanelEntry> = [
    ...panels,
    ...visibleBrowserPanels,
  ];
  const sessionList = useStableListEntries(
    listEntries,
    (panel) => ('browserCapability' in panel ? panel.browserCapability : panel.panelId),
    reducedMotion,
  );
  useAndroidBack('', () => {
    onBack();
    return true;
  });
  const canCreate = state.connection === 'online' && state.canControlInput && !state.isDemo;
  useEffect(() => {
    if (surfaceCreateStatus === 'completed') {
      setCreateSheetOpen(false);
      setPendingSurface(null);
    }
  }, [surfaceCreateStatus]);
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.header}>
        <MotionPressable
          accessibilityLabel={t('返回首页')}
          accessibilityRole="button"
          onPress={onBack}
          style={styles.headerButton}
        >
          <ChevronLeft color={theme.colors.text2} size={23} />
        </MotionPressable>
        <View style={styles.titleCopy}>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.title}>{workspace.label}</Text>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.subtitle}>
            {presentedConnection === 'online'
              ? t('在线')
              : presentedConnection === 'confirming'
                ? t('正在确认')
                : presentedConnection === 'reconnecting' ? t('正在重连') : t('离线只读')}
          </Text>
        </View>
        <ProgressiveRefreshButton
          idleLabel={t('刷新项目会话')}
          pendingLabel={t('正在刷新项目会话')}
          onRefresh={onRefresh}
          size={19}
          status={refreshStatus}
          style={styles.headerButton}
          theme={theme}
        />
        <MotionPressable
          accessibilityLabel={t('新建项目会话')}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canCreate }}
          disabled={!canCreate}
          onPress={() => setCreateSheetOpen(true)}
          style={[styles.headerButton, !canCreate ? styles.disabled : null]}
        >
          <Plus color={theme.colors.text2} size={21} />
        </MotionPressable>
      </View>
      {showFiles ? (
        <View style={styles.sectionBar}>
          <SegmentedTabs
            onChange={(next) => {
              lastSectionByWorkspace.set(workspace.label, next);
              setSection(next);
            }}
            options={[
              { value: 'sessions', label: t('会话') },
              { value: 'files', label: t('文件') },
            ]}
            testID="project-sections"
            theme={theme}
            value={activeSection}
          />
        </View>
      ) : null}
      {activeSection === 'files' && !filesAvailable ? (
        <View style={[styles.list, styles.listEmpty, styles.emptyState]}>
          <Text style={styles.emptyText}>{t('在电脑上更新 Connect 后可用')}</Text>
        </View>
      ) : activeSection === 'files' && fileTransport !== null ? (
        <WorkspaceFilesPane
          canWrite={canCreate}
          onFileRemoved={(subPath) => {
            if (openFile !== null && (openFile === subPath || openFile.startsWith(`${subPath}/`))) setOpenFile(null);
          }}
          onOpenFile={setOpenFile}
          online={state.connection === 'online'}
          selectedSubPath={openFile}
          theme={theme}
          transport={fileTransport}
          workspaceCapability={workspace.workspaceCapability}
          workspaceLabel={workspace.label}
        />
      ) : (
        <FlatList
          contentContainerStyle={[
            styles.list,
            sessionList.entries.length === 0 && pendingSurface === null ? styles.listEmpty : null,
          ]}
          data={sessionList.entries}
          keyExtractor={(entry) => entry.key}
          ListFooterComponent={pendingSurface ? (
            <SurfaceLifecyclePlaceholder
              error={surfaceCreateError}
              kind={pendingSurface.kind}
              onDismiss={() => {
                setPendingSurface(null);
                onCreateDismiss();
              }}
              onRetry={() => onCreate(
                pendingSurface.workspaceCapability,
                pendingSurface.kind,
              )}
              status={surfaceCreateStatus}
              theme={theme}
              variant="row"
            />
          ) : null}
          ListEmptyComponent={(
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('当前没有活动会话')}</Text>
              <Text style={styles.emptyText}>
                {canCreate ? t('使用右上角新建会话') : t('连接恢复或获得写权限后可新建')}
              </Text>
            </View>
          )}
          renderItem={({ item: entry }) => {
            if (entry.type === 'tombstone') {
              return (
                <StableListExit
                  height={72}
                  onComplete={() => sessionList.finishExit(entry.id)}
                  reducedMotion={reducedMotion}
                  style={styles.sessionExit}
                  testID="session-list-exit"
                />
              );
            }
            const item = entry.item;
            const readOnly = state.connection !== 'online';
            if ('browserCapability' in item) {
              // 网页面板行与终端会话同构（设计 §5.5）：图标 + 标题 + 一行说明，不暴露 URL。
              return (
                <StableMotionRow
                  animateEnter={entry.entering}
                  reducedMotion={reducedMotion}
                  testID="session-motion-row"
                >
                  <MotionPressable
                    accessibilityLabel={t('打开网页 {label}', { label: item.title })}
                    accessibilityRole="button"
                    feedback="selection"
                    onPress={() => onBrowser?.(item.browserCapability)}
                    style={[styles.sessionRow, readOnly ? styles.disabled : null]}
                  >
                    <KindIcon kind="web" size={23} theme={theme} />
                    <View style={styles.sessionCopy}>
                      <Text numberOfLines={1} style={styles.sessionLabel}>{item.title}</Text>
                      <Text style={styles.sessionDetail}>{t('网页')}</Text>
                    </View>
                  </MotionPressable>
                </StableMotionRow>
              );
            }
            const selected = item.panelId === state.activePanelId;
            return (
              <StableMotionRow
                animateEnter={entry.entering}
                reducedMotion={reducedMotion}
                testID="session-motion-row"
              >
                <MotionPressable
                  accessibilityLabel={t('打开会话 {label}', { label: panelDisplayLabel(item) })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  feedback={selected ? undefined : 'selection'}
                  onPress={() => onSession(item.panelId)}
                  style={[styles.sessionRow, readOnly ? styles.disabled : null]}
                >
                  <KindIcon kind={item.kind} size={23} theme={theme} />
                  <View style={styles.sessionCopy}>
                    <Text numberOfLines={1} style={styles.sessionLabel}>{panelDisplayLabel(item)}</Text>
                    <Text style={styles.sessionDetail}>{item.kind === 'collaboration' ? t('协作会话') : t('终端会话')}</Text>
                  </View>
                  {panelStatuses[item.panelId] !== undefined ? (
                    <PanelStatusLamp
                      label={panelStatusLabel(panelStatuses[item.panelId]!)}
                      testID={`session-status-${item.panelId}`}
                      theme={theme}
                      tone={lampTone(panelStatuses[item.panelId]!)}
                    />
                  ) : null}
                  <SelectionIndicator
                    reducedMotion={reducedMotion}
                    selected={selected}
                    testID="session-selection-indicator"
                  >
                    <View style={styles.activeMark} />
                  </SelectionIndicator>
                </MotionPressable>
              </StableMotionRow>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
      {filesAvailable && fileTransport !== null ? (
        <Modal
          animationType="slide"
          onRequestClose={() => setOpenFile(null)}
          presentationStyle="fullScreen"
          visible={openFile !== null}
        >
          <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.root}>
            {openFile !== null ? (
              <WorkspaceFileViewer
                canWrite={canCreate}
                chrome="modal"
                documentKey={`${workspace.label}:${openFile}`}
                onClose={() => setOpenFile(null)}
                subPath={openFile}
                theme={theme}
                transport={fileTransport}
                workspaceCapability={workspace.workspaceCapability}
              />
            ) : null}
          </SafeAreaView>
        </Modal>
      ) : null}
      <SurfaceCreateSheet
        error={surfaceCreateError}
        initialWorkspaceCapability={workspace.workspaceCapability}
        onClose={() => {
          setCreateSheetOpen(false);
          onCreateDismiss();
        }}
        onCreate={(workspaceCapability, kind) => {
          setPendingSurface({ workspaceCapability, kind });
          setCreateSheetOpen(false);
          onCreate(workspaceCapability, kind);
        }}
        open={createSheetOpen}
        status={surfaceCreateStatus}
        theme={theme}
        workspaceLocked
        workspaces={[workspace]}
      />
    </SafeAreaView>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    header: {
      minHeight: 64,
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
    sectionBar: { paddingHorizontal: SPACE.x3, paddingVertical: SPACE.x2 },
    list: { paddingHorizontal: SPACE.x3, paddingBottom: SPACE.x6 },
    listEmpty: { flex: 1 },
    sessionRow: {
      minHeight: 72,
      paddingHorizontal: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x3,
    },
    sessionCopy: { minWidth: 0, flex: 1, gap: SPACE.x1 },
    sessionExit: {
      marginHorizontal: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      backgroundColor: theme.colors.panel2,
    },
    sessionLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    sessionDetail: { color: theme.colors.text3, fontSize: 12 },
    activeMark: { width: 7, height: 7, borderRadius: RADIUS.pill, backgroundColor: theme.colors.ok },
    disabled: { opacity: 0.55 },
    emptyState: { alignItems: 'center', justifyContent: 'center', gap: SPACE.x2 },
    emptyTitle: { color: theme.colors.text2, fontSize: 16, fontWeight: '600' },
    emptyText: { color: theme.colors.text3, fontSize: 13, textAlign: 'center' },
  });
}
