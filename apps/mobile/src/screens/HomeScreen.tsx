import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Download, Folder, ScanLine, Settings } from 'lucide-react-native';
import type { PublicAppInfo, PublicLinkKind } from '../../../../src/shared/types';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ConnectionState, SessionViewModel } from '../domain/session';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { ConnectionBar } from '../components/ConnectionBar';
import { KindIcon } from '../components/KindIcon';
import { MotionPressable } from '../components/MotionPressable';
import {
  ProgressiveRefreshButton,
  type RefreshStatus,
} from '../components/ProgressiveRefreshButton';
import { t } from '../i18n';
import { useReducedMotion } from '../theme/reducedMotion';
import {
  StableListExit,
  StableMotionRow,
  useStableListEntries,
} from '../components/StableMotionList';

export function HomeScreen({
  state,
  presentedConnection = state.connection,
  connectionDetail,
  theme,
  refreshStatus,
  onPair,
  onProject,
  onRefresh,
  publicAppInfo,
  onOpenPublicLink,
  onOpenSettings,
}: {
  state: SessionViewModel;
  presentedConnection?: ConnectionState;
  /**
   * 连接失败的原因。首页是连不上时用户唯一能停留的屏幕——目录到不了就没有会话可进——
   * 所以这句话必须能在这里说出来，否则分类算得再准也没人看得见。
   */
  connectionDetail?: string | null;
  theme: ConnectTheme;
  refreshStatus: RefreshStatus;
  onPair(): void;
  onProject(workspaceCapability: string): void;
  onRefresh(): void;
  publicAppInfo?: PublicAppInfo;
  onOpenPublicLink?(kind: PublicLinkKind): Promise<void>;
  /** 首页右上角的设置入口（取代底部 tab）；与原 tab 一致，未绑定电脑时不出现。 */
  onOpenSettings?(): void;
}): React.ReactElement {
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  const [publicLinkPending, setPublicLinkPending] = useState(false);
  const [publicLinkError, setPublicLinkError] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const projectList = useStableListEntries(
    state.workspaces,
    (workspace) => workspace.workspaceCapability,
    reducedMotion,
  );
  const workspacePanels = (capability: string) => state.panels.filter(
    (panel) => panel.workspaceCapability === capability,
  );
  const macDownloadConfigured = publicAppInfo?.links.macDownload !== null
    && publicAppInfo?.links.macDownload !== undefined;
  const openMacDownload = async (): Promise<void> => {
    if (!macDownloadConfigured || !onOpenPublicLink || publicLinkPending) return;
    setPublicLinkPending(true);
    setPublicLinkError(null);
    try {
      await onOpenPublicLink('macDownload');
    } catch {
      setPublicLinkError(t('无法打开链接，请重试。'));
    } finally {
      setPublicLinkPending(false);
    }
  };
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <ConnectionBar
        deviceName={state.deviceName}
        connection={presentedConnection}
        isDemo={state.isDemo}
        theme={theme}
        trailing={onOpenSettings && state.connection !== 'unpaired' ? (
          <MotionPressable
            accessibilityLabel={t('设置')}
            accessibilityRole="button"
            onPress={onOpenSettings}
            style={styles.iconButton}
          >
            <Settings color={theme.colors.text2} size={20} />
          </MotionPressable>
        ) : null}
      />
      {connectionDetail ? (
        <Text accessibilityRole="alert" style={styles.connectionDetail}>
          {t(connectionDetail)}
        </Text>
      ) : null}
      {state.connection !== 'unpaired' ? (
        <View style={styles.heading}>
          <Text style={styles.title}>{t('项目')}</Text>
          <ProgressiveRefreshButton
            idleLabel={t('刷新项目')}
            pendingLabel={t('正在刷新项目')}
            onRefresh={onRefresh}
            status={refreshStatus}
            style={styles.iconButton}
            theme={theme}
          />
        </View>
      ) : null}
      {state.connection === 'unpaired' ? (
        <ScrollView
          contentContainerStyle={styles.emptyState}
          showsVerticalScrollIndicator={false}
          style={styles.emptyScroll}
        >
          <KindIcon kind="shell" size={30} theme={theme} />
          <Text accessibilityLabel={t('尚未绑定电脑')} style={styles.emptyTitle}>{t('尚未绑定电脑')}</Text>
          <Text style={styles.emptyText}>{state.isDemo ? t('演示连接') : t('在电脑端打开 Connect 配对')}</Text>
          <MotionPressable
            accessibilityLabel={t('扫描二维码')}
            accessibilityRole="button"
            onPress={onPair}
            style={styles.primaryAction}
          >
            <ScanLine color={theme.colors.bg} size={19} />
            <Text style={styles.primaryActionText}>{t('扫描二维码')}</Text>
          </MotionPressable>
          <MotionPressable
            accessibilityLabel={macDownloadConfigured ? t('下载 Mac 版') : t('Mac 下载尚未配置')}
            accessibilityRole="button"
            accessibilityState={{
              busy: publicLinkPending,
              disabled: !macDownloadConfigured || publicLinkPending,
            }}
            disabled={!macDownloadConfigured || publicLinkPending}
            onPress={() => void openMacDownload()}
            style={[
              styles.secondaryAction,
              !macDownloadConfigured || publicLinkPending ? styles.disabled : null,
            ]}
          >
            <Download color={theme.colors.text2} size={18} />
            <Text style={styles.secondaryActionText}>
              {macDownloadConfigured ? t('下载 Mac 版') : t('Mac 下载尚未配置')}
            </Text>
          </MotionPressable>
          {publicLinkError ? (
            <Text accessibilityRole="alert" style={styles.inlineError}>{publicLinkError}</Text>
          ) : null}
        </ScrollView>
      ) : (
        <FlatList
          contentContainerStyle={[
            styles.list,
            { paddingBottom: SPACE.x6 + insets.bottom },
            projectList.entries.length === 0 ? styles.listEmpty : null,
          ]}
          data={projectList.entries}
          keyExtractor={(entry) => entry.key}
          ListEmptyComponent={(
            <Text style={styles.emptyText}>
              {state.connection === 'offline' ? t('离线，暂无已验证项目') : t('暂无已授权项目')}
            </Text>
          )}
          renderItem={({ item: entry }) => {
            if (entry.type === 'tombstone') {
              return (
                <StableListExit
                  height={76}
                  onComplete={() => projectList.finishExit(entry.id)}
                  reducedMotion={reducedMotion}
                  style={styles.projectExit}
                  testID="project-list-exit"
                />
              );
            }
            const item = entry.item;
            const panels = workspacePanels(item.workspaceCapability);
            const activeCount = item.activeSurfaceCount;
            const dimmed = presentedConnection !== 'online';
            return (
              <StableMotionRow
                animateEnter={entry.entering}
                reducedMotion={reducedMotion}
                testID="project-motion-row"
              >
                <MotionPressable
                  accessibilityLabel={t('项目 {label}', { label: item.label })}
                  accessibilityRole="button"
                  feedback="selection"
                  onPress={() => onProject(item.workspaceCapability)}
                  style={[styles.projectRow, dimmed ? styles.projectRowDisabled : null]}
                >
                  <Folder color={theme.colors.text2} size={22} />
                  <View style={styles.projectCopy}>
                    <Text numberOfLines={1} style={styles.projectLabel}>{item.label}</Text>
                    <View style={styles.projectMeta}>
                      <View style={[styles.statusDot, presentedConnection === 'online' ? styles.statusOnline : styles.statusOffline]} />
                      <Text style={styles.projectDetail}>
                        {activeCount === 0 && panels.length === 0
                          ? t('最近项目')
                          : t('{count} 个活动会话{sync}', {
                            count: activeCount,
                            sync: panels.length !== activeCount ? t(' · 正在同步') : '',
                          })}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </MotionPressable>
              </StableMotionRow>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    heading: {
      minHeight: 52,
      paddingHorizontal: SPACE.x4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    list: { paddingHorizontal: SPACE.x3, paddingBottom: SPACE.x6 },
    listEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    projectRow: {
      minHeight: 76,
      paddingHorizontal: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x3,
    },
    projectRowDisabled: { opacity: 0.56 },
    projectExit: {
      marginHorizontal: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      backgroundColor: theme.colors.panel2,
    },
    projectCopy: { minWidth: 0, flex: 1, gap: SPACE.x1 },
    projectLabel: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
    projectMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACE.x1 },
    statusDot: { width: 7, height: 7, borderRadius: RADIUS.pill },
    statusOnline: { backgroundColor: theme.colors.ok },
    statusOffline: { backgroundColor: theme.colors.text3 },
    projectDetail: { color: theme.colors.text3, fontSize: 12 },
    chevron: { color: theme.colors.text3, fontSize: 26, fontWeight: '300' },
    emptyScroll: { flex: 1 },
    emptyState: {
      flexGrow: 1,
      padding: SPACE.x6,
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x2,
    },
    emptyTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
    emptyText: { color: theme.colors.text3, fontSize: 14, textAlign: 'center' },
    connectionDetail: {
      paddingHorizontal: SPACE.x3,
      paddingVertical: SPACE.x2,
      backgroundColor: theme.colors.panel2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      color: theme.colors.warn,
      fontSize: 13,
    },
    // The only primary action on the unpaired screen: filled, matching the
    // desktop's primary button (text-colour fill, background-colour label).
    primaryAction: {
      minHeight: 48,
      marginTop: SPACE.x3,
      paddingHorizontal: SPACE.x5,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.text,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x2,
    },
    primaryActionText: { color: theme.colors.bg, fontSize: 15, fontWeight: '600' },
    secondaryAction: {
      minHeight: 44,
      paddingHorizontal: SPACE.x3,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x2,
    },
    secondaryActionText: { color: theme.colors.text2, fontSize: 13, fontWeight: '600' },
    inlineError: { color: theme.colors.danger, fontSize: 12, lineHeight: 18, textAlign: 'center' },
    disabled: { opacity: 0.45 },
  });
}
