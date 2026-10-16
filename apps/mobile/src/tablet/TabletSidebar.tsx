import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Folder, Plus, Settings } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type {
  ConnectionState,
  SessionPanelSummary,
  SessionViewModel,
  SessionWorkspaceSummary,
} from '../domain/session';
import { panelDisplayLabel } from '../domain/panelLabel';
import type { WorkspaceFileTransport } from '../domain/workspaceFiles';
import { ConnectionBar } from '../components/ConnectionBar';
import { KindIcon } from '../components/KindIcon';
import { MotionPressable } from '../components/MotionPressable';
import {
  ProgressiveRefreshButton,
  type RefreshStatus,
} from '../components/ProgressiveRefreshButton';
import { SegmentedTabs } from '../components/SegmentedTabs';
import { WorkspaceFilesPane } from '../components/files/WorkspaceFilesPane';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';

export type TabletSidebarMode = 'projects' | 'files';

/**
 * iPad 侧栏，对应 Mac 左侧栏：「项目」= 工作区列表（展开即其会话），「文件」= 当前项目的
 * 资源管理器。只是排版不同，所有动作都回到 App 里与 iPhone 同一套处理函数。
 */
export function TabletSidebar({
  state,
  presentedConnection,
  theme,
  width,
  mode,
  filesSupported,
  filesNeedDesktopUpdate = false,
  fileTransport,
  currentWorkspace,
  panels,
  activePanelId,
  activeFileSubPath,
  settingsActive,
  refreshStatus,
  onModeChange,
  onRefresh,
  onOpenProject,
  onOpenSession,
  onCreateSession,
  onOpenFile,
  onFileRemoved,
  onOpenSettings,
}: {
  state: SessionViewModel;
  presentedConnection: ConnectionState;
  theme: ConnectTheme;
  width: number;
  mode: TabletSidebarMode;
  filesSupported: boolean;
  /** 桌面回答了探针但没有文件能力：保留「文件」入口，内容提示在电脑上更新。 */
  filesNeedDesktopUpdate?: boolean;
  fileTransport: WorkspaceFileTransport;
  currentWorkspace: SessionWorkspaceSummary | null;
  panels: readonly SessionPanelSummary[];
  activePanelId: string | null;
  activeFileSubPath: string | null;
  settingsActive: boolean;
  refreshStatus: RefreshStatus;
  onModeChange(mode: TabletSidebarMode): void;
  onRefresh(): void;
  onOpenProject(workspaceCapability: string): void;
  onOpenSession(panelId: string, workspaceCapability: string): void;
  onCreateSession(workspaceCapability: string): void;
  onOpenFile(workspaceCapability: string, subPath: string): void;
  onFileRemoved(workspaceCapability: string, subPath: string): void;
  onOpenSettings(): void;
}): React.ReactElement {
  const styles = createStyles(theme);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const online = state.connection === 'online';
  const canWrite = online && state.canControlInput && !state.isDemo;
  const showFiles = (filesSupported || filesNeedDesktopUpdate) && !state.isDemo;
  const activeMode: TabletSidebarMode = showFiles ? mode : 'projects';
  const currentCapability = currentWorkspace?.workspaceCapability ?? null;

  return (
    <SafeAreaView edges={['top', 'left', 'bottom']} style={[styles.root, { width }]}>
      <ConnectionBar
        connection={presentedConnection}
        deviceName={state.deviceName}
        isDemo={state.isDemo}
        theme={theme}
        trailing={(
          <View style={styles.headerActions}>
            <ProgressiveRefreshButton
              idleLabel={t('刷新')}
              onRefresh={onRefresh}
              pendingLabel={t('正在刷新')}
              size={18}
              status={refreshStatus}
              style={styles.iconButton}
              theme={theme}
            />
            <MotionPressable
              accessibilityLabel={t('设置')}
              accessibilityRole="button"
              accessibilityState={{ selected: settingsActive }}
              onPress={onOpenSettings}
              style={[styles.iconButton, settingsActive ? styles.iconButtonActive : null]}
            >
              <Settings color={settingsActive ? theme.colors.accent : theme.colors.text2} size={19} />
            </MotionPressable>
          </View>
        )}
      />
      {showFiles ? (
        <View style={styles.modeBar}>
          <SegmentedTabs
            onChange={onModeChange}
            options={[
              { value: 'projects', label: t('项目') },
              { value: 'files', label: t('文件') },
            ]}
            testID="tablet-sidebar-modes"
            theme={theme}
            value={activeMode}
          />
        </View>
      ) : null}
      {activeMode === 'files' ? (
        !filesSupported ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('在电脑上更新 Connect 后可用')}</Text>
          </View>
        ) : currentWorkspace === null ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{t('先在「项目」里选择一个项目')}</Text>
          </View>
        ) : (
          <View style={styles.filesPane}>
            <MotionPressable
              accessibilityLabel={t('切换项目，当前 {label}', { label: currentWorkspace.label })}
              accessibilityRole="button"
              onPress={() => onModeChange('projects')}
              style={styles.filesProject}
            >
              <Folder color={theme.colors.text2} size={16} />
              <Text numberOfLines={1} style={styles.filesProjectLabel}>{currentWorkspace.label}</Text>
            </MotionPressable>
            <WorkspaceFilesPane
              canWrite={canWrite}
              onFileRemoved={(subPath) => onFileRemoved(currentWorkspace.workspaceCapability, subPath)}
              onOpenFile={(subPath) => onOpenFile(currentWorkspace.workspaceCapability, subPath)}
              online={online}
              selectedSubPath={activeFileSubPath}
              theme={theme}
              transport={fileTransport}
              workspaceCapability={currentWorkspace.workspaceCapability}
              workspaceLabel={currentWorkspace.label}
            />
          </View>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.projects} showsVerticalScrollIndicator={false}>
          {state.workspaces.length === 0 ? (
            <Text style={styles.emptyText}>
              {state.connection === 'offline' ? t('离线，暂无已验证项目') : t('暂无已授权项目')}
            </Text>
          ) : null}
          {state.workspaces.map((workspace) => {
            const current = workspace.workspaceCapability === currentCapability;
            const expanded = current
              ? !collapsed.has(workspace.workspaceCapability)
              : false;
            const workspacePanels = panels.filter(
              (panel) => panel.workspaceCapability === workspace.workspaceCapability,
            );
            return (
              <View key={workspace.workspaceCapability}>
                <MotionPressable
                  accessibilityLabel={t('项目 {label}', { label: workspace.label })}
                  accessibilityRole="button"
                  accessibilityState={{ expanded, selected: current }}
                  feedback="selection"
                  onPress={() => {
                    if (current) {
                      setCollapsed((previous) => {
                        const next = new Set(previous);
                        if (next.has(workspace.workspaceCapability)) next.delete(workspace.workspaceCapability);
                        else next.add(workspace.workspaceCapability);
                        return next;
                      });
                      return;
                    }
                    onOpenProject(workspace.workspaceCapability);
                  }}
                  style={[styles.projectRow, current ? styles.rowCurrent : null]}
                >
                  <View style={expanded ? styles.chevronOpen : null}>
                    <ChevronRight color={theme.colors.text3} size={14} />
                  </View>
                  <Folder color={theme.colors.text2} size={18} />
                  <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.projectLabel}>
                    {workspace.label}
                  </Text>
                  {workspace.activeSurfaceCount > 0 ? (
                    <Text style={styles.count}>{workspace.activeSurfaceCount}</Text>
                  ) : null}
                </MotionPressable>
                {expanded ? (
                  <View>
                    {workspacePanels.map((panel) => {
                      const selected = panel.panelId === activePanelId && !settingsActive && activeFileSubPath === null;
                      return (
                        <MotionPressable
                          accessibilityLabel={t('打开会话 {label}', { label: panelDisplayLabel(panel) })}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          feedback={selected ? undefined : 'selection'}
                          key={panel.panelId}
                          onPress={() => onOpenSession(panel.panelId, workspace.workspaceCapability)}
                          style={[styles.sessionRow, selected ? styles.rowSelected : null, !online ? styles.dimmed : null]}
                        >
                          <KindIcon kind={panel.kind} size={17} theme={theme} />
                          <Text numberOfLines={1} style={styles.sessionLabel}>{panelDisplayLabel(panel)}</Text>
                        </MotionPressable>
                      );
                    })}
                    <MotionPressable
                      accessibilityLabel={t('新建项目会话')}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !canWrite }}
                      disabled={!canWrite}
                      onPress={() => onCreateSession(workspace.workspaceCapability)}
                      style={[styles.sessionRow, !canWrite ? styles.dimmed : null]}
                    >
                      <Plus color={theme.colors.text3} size={16} />
                      <Text style={styles.createLabel}>{t('新建会话')}</Text>
                    </MotionPressable>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: {
      backgroundColor: theme.colors.panel,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: theme.colors.line,
    },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconButtonActive: { backgroundColor: theme.colors.panel2 },
    modeBar: { paddingHorizontal: SPACE.x3, paddingBottom: SPACE.x2 },
    projects: { paddingHorizontal: SPACE.x2, paddingBottom: SPACE.x6 },
    projectRow: {
      minHeight: 40,
      paddingHorizontal: SPACE.x2,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    rowCurrent: { backgroundColor: theme.colors.bg },
    chevronOpen: { transform: [{ rotate: '90deg' }] },
    projectLabel: { minWidth: 0, flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: '600' },
    count: { color: theme.colors.text3, fontSize: 12 },
    sessionRow: {
      minHeight: 38,
      marginLeft: SPACE.x5,
      paddingHorizontal: SPACE.x2,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    rowSelected: { backgroundColor: theme.colors.panel2 },
    sessionLabel: { minWidth: 0, flex: 1, color: theme.colors.text, fontSize: 13 },
    createLabel: { color: theme.colors.text3, fontSize: 13 },
    dimmed: { opacity: 0.5 },
    filesPane: { flex: 1 },
    filesProject: {
      minHeight: 34,
      marginHorizontal: SPACE.x3,
      paddingHorizontal: SPACE.x2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.bg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    filesProjectLabel: { minWidth: 0, flex: 1, color: theme.colors.text2, fontSize: 13, fontWeight: '600' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.x4 },
    emptyText: { color: theme.colors.text3, fontSize: 13, textAlign: 'center', padding: SPACE.x3 },
  });
}
