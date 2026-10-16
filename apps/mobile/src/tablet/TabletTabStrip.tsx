import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PanelLeft, Plus, X } from 'lucide-react-native';
import type { SessionPanelSummary } from '../domain/session';
import { panelDisplayLabel } from '../domain/panelLabel';
import { FileIcon } from '../files/fileIcon';
import { KindIcon } from '../components/KindIcon';
import { MotionPressable } from '../components/MotionPressable';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';

export interface TabletFileTab {
  workspaceCapability: string;
  /** 重连后 capability 会轮换；按唯一 label 重新对上（与路由重验同口径）。 */
  workspaceLabel: string;
  subPath: string;
}

export function tabletFileTabKey(tab: Pick<TabletFileTab, 'workspaceCapability' | 'subPath'>): string {
  return `${tab.workspaceCapability}:${tab.subPath}`;
}

/**
 * iPad 主区标签条，对应 Mac Dockview 的标签：当前项目的会话 + 已打开的文件。
 * 会话标签只切换（关闭仍走会话页的受控关闭与确认）；文件标签是本地视图，可直接关。
 */
export function TabletTabStrip({
  theme,
  sidebarVisible,
  sessions,
  files,
  activePanelId,
  activeFileKey,
  canCreate,
  onToggleSidebar,
  onSelectSession,
  onSelectFile,
  onCloseFile,
  onCreateSession,
}: {
  theme: ConnectTheme;
  sidebarVisible: boolean;
  sessions: readonly SessionPanelSummary[];
  files: readonly TabletFileTab[];
  activePanelId: string | null;
  activeFileKey: string | null;
  canCreate: boolean;
  onToggleSidebar(): void;
  onSelectSession(panel: SessionPanelSummary): void;
  onSelectFile(tab: TabletFileTab): void;
  onCloseFile(tab: TabletFileTab): void;
  onCreateSession(): void;
}): React.ReactElement {
  const styles = createStyles(theme);
  const scrollRef = useRef<ScrollView>(null);
  const tabX = useRef(new Map<string, number>());
  const activeKey = activeFileKey ?? (activePanelId === null ? null : `panel:${activePanelId}`);
  // 新打开的文件排在会话之后，常落在可视区外：激活的标签总要滚进视野。
  useEffect(() => {
    if (activeKey === null) return;
    const x = tabX.current.get(activeKey);
    if (x !== undefined) scrollRef.current?.scrollTo({ x: Math.max(0, x - 48), animated: false });
  }, [activeKey]);
  const remember = (key: string) => (event: { nativeEvent: { layout: { x: number } } }) => {
    tabX.current.set(key, event.nativeEvent.layout.x);
    if (key === activeKey) scrollRef.current?.scrollTo({ x: Math.max(0, event.nativeEvent.layout.x - 48), animated: false });
  };
  return (
    <View style={styles.root} testID="tablet-tab-strip">
      <MotionPressable
        accessibilityLabel={sidebarVisible ? t('隐藏侧栏') : t('显示侧栏')}
        accessibilityRole="button"
        onPress={onToggleSidebar}
        style={styles.iconButton}
      >
        <PanelLeft color={theme.colors.text2} size={18} />
      </MotionPressable>
      <ScrollView
        contentContainerStyle={styles.tabs}
        horizontal
        ref={scrollRef}
        showsHorizontalScrollIndicator={false}
        style={styles.scroller}
      >
        {sessions.map((panel) => {
          const selected = activeFileKey === null && panel.panelId === activePanelId;
          return (
            <MotionPressable
              accessibilityLabel={panelDisplayLabel(panel)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={panel.panelId}
              onLayout={remember(`panel:${panel.panelId}`)}
              onPress={() => onSelectSession(panel)}
              style={[styles.tab, selected ? styles.tabSelected : null]}
            >
              <KindIcon kind={panel.kind} size={15} theme={theme} />
              <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={[styles.label, selected ? styles.labelSelected : null]}>
                {panelDisplayLabel(panel)}
              </Text>
            </MotionPressable>
          );
        })}
        {files.map((tab) => {
          const key = tabletFileTabKey(tab);
          const selected = key === activeFileKey;
          const name = tab.subPath.slice(tab.subPath.lastIndexOf('/') + 1);
          return (
            <MotionPressable
              accessibilityLabel={name}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={key}
              onLayout={remember(key)}
              onPress={() => onSelectFile(tab)}
              style={[styles.tab, selected ? styles.tabSelected : null]}
            >
              <FileIcon dir={false} expanded={false} name={name} size={15} theme={theme.mode} />
              <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={[styles.label, selected ? styles.labelSelected : null]}>
                {name}
              </Text>
              <MotionPressable
                accessibilityLabel={t('关闭 {name}', { name })}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => onCloseFile(tab)}
                style={styles.close}
              >
                <X color={theme.colors.text3} size={13} />
              </MotionPressable>
            </MotionPressable>
          );
        })}
      </ScrollView>
      <MotionPressable
        accessibilityLabel={t('新建项目会话')}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canCreate }}
        disabled={!canCreate}
        onPress={onCreateSession}
        style={[styles.iconButton, !canCreate ? styles.disabled : null]}
      >
        <Plus color={theme.colors.text2} size={19} />
      </MotionPressable>
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: {
      minHeight: 44,
      paddingHorizontal: SPACE.x1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      backgroundColor: theme.colors.panel,
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disabled: { opacity: 0.45 },
    scroller: { flex: 1 },
    tabs: { alignItems: 'center', gap: SPACE.x1, paddingHorizontal: SPACE.x1 },
    tab: {
      maxWidth: 220,
      minHeight: 32,
      paddingHorizontal: SPACE.x2,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    tabSelected: { backgroundColor: theme.colors.bg },
    label: { flexShrink: 1, color: theme.colors.text3, fontSize: 13 },
    labelSelected: { color: theme.colors.text, fontWeight: '600' },
    close: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  });
}
