import { useEffect, useRef, useState } from 'react';
import type { MobilePanelStatus } from '../../../../src/shared/types';
import { PanelStatusLamp, lampTone, panelStatusLabel } from '../components/PanelStatusLamp';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PanelLeft, Plus, X } from 'lucide-react-native';
import type { SessionPanelSummary } from '../domain/session';
import { panelDisplayLabel } from '../domain/panelLabel';
import { tabStripScrollTarget, tabStripTrailingPad, type TabletBrowserTab } from './tabletLayout';
import { FileIcon } from '../files/fileIcon';
import { KindIcon } from '../components/KindIcon';
import { MotionPressable } from '../components/MotionPressable';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';
import { usePanelRenameDraft } from '../components/usePanelRenameDraft';

export interface TabletFileTab {
  workspaceCapability: string;
  /** 重连后 capability 会轮换；按唯一 label 重新对上（与路由重验同口径）。 */
  workspaceLabel: string;
  subPath: string;
}

const NO_PANEL_STATUSES: Readonly<Record<string, MobilePanelStatus>> = {};

export function tabletFileTabKey(tab: Pick<TabletFileTab, 'workspaceCapability' | 'subPath'>): string {
  return `${tab.workspaceCapability}:${tab.subPath}`;
}

/**
 * iPad 主区标签条，对应 Mac Dockview 的标签：当前项目的会话 + 已打开的文件。
 * 会话标签只切换（关闭仍走会话页的受控关闭与确认）；文件标签是本地视图，可直接关。
 * 长按当前会话标签就地改名（用户 2026-11-02，对应电脑双击标签）；VoiceOver 走「重命名」动作。
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
  online = false,
  panelStatuses = NO_PANEL_STATUSES,
  browserTab = null,
  browserActive = false,
  onSelectBrowser,
  onCloseBrowser,
  onRenameSession,
}: {
  /** Lamps show only while connected: an old colour must not pass for the current one. */
  online?: boolean;
  /** The desktop's lamp per panel (MOBILE-SESSION-RUN-STATE-01). */
  panelStatuses?: Readonly<Record<string, MobilePanelStatus>>;
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
  /** ADR-003 §19：已打开的网页镜像占一个标签；没有就是 null（旧桌面永远是 null）。 */
  browserTab?: TabletBrowserTab | null;
  browserActive?: boolean;
  onSelectBrowser?(tab: TabletBrowserTab): void;
  onCloseBrowser?(tab: TabletBrowserTab): void;
  /** 给当前会话改名；只读、离线或电脑不支持时不传，长按就什么也不做。空白恢复自动名称。 */
  onRenameSession?(panelId: string, title: string): Promise<void>;
}): React.ReactElement {
  const styles = createStyles(theme);
  const rename = usePanelRenameDraft(activePanelId, onRenameSession);
  const scrollRef = useRef<ScrollView>(null);
  const tabLayout = useRef(new Map<string, { start: number; end: number }>());
  const viewportWidth = useRef(0);
  const scrollX = useRef(0);
  // 溢出不足一个标签宽时补在末尾的空白，让对齐到标签起点的滚动够得着（见 tabStripTrailingPad）。
  const [trailingPad, setTrailingPad] = useState(0);
  const pendingScroll = useRef<number | null>(null);
  const browserKey = browserTab === null ? null : `web:${browserTab.browserCapability}`;
  const browserSelected = browserActive && browserTab !== null;
  const activeKey = browserSelected
    ? browserKey
    : activeFileKey ?? (activePanelId === null ? null : `panel:${activePanelId}`);
  // 新打开的文件排在会话之后，常落在可视区外：激活的标签总要滚进视野；
  // 只滚最少的距离、左边缘对齐标签起点，不切掉半个标签（2026-11-02）。
  // 已关闭的标签不再参与对齐。
  const liveKeys = new Set<string>([
    ...sessions.map((panel) => `panel:${panel.panelId}`),
    ...files.map(tabletFileTabKey),
    ...(browserKey === null ? [] : [browserKey]),
  ]);
  for (const key of [...tabLayout.current.keys()]) if (!liveKeys.has(key)) tabLayout.current.delete(key);
  const reveal = (key: string | null): void => {
    if (key === null) return;
    const active = tabLayout.current.get(key);
    if (active === undefined) return;
    const tabs = [...tabLayout.current.values()].sort((a, b) => a.start - b.start);
    const target = tabStripScrollTarget(tabs, active, viewportWidth.current, scrollX.current);
    const pad = tabStripTrailingPad(tabs, target, viewportWidth.current, SPACE.x1);
    if (pad !== trailingPad) {
      // 先让内容变长，等 onContentSizeChange 再滚，否则会被夹回旧的可滚上限。
      pendingScroll.current = target;
      setTrailingPad(pad);
      return;
    }
    if (target === scrollX.current) return;
    scrollX.current = target;
    scrollRef.current?.scrollTo({ x: target, animated: false });
  };
  useEffect(() => {
    reveal(activeKey);
  }, [activeKey]);
  const remember = (key: string) => (event: { nativeEvent: { layout: { x: number; width: number } } }) => {
    const { x, width } = event.nativeEvent.layout;
    tabLayout.current.set(key, { start: x, end: x + width });
    if (key === activeKey) reveal(key);
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
        contentContainerStyle={[styles.tabs, { paddingRight: SPACE.x1 + trailingPad }]}
        onContentSizeChange={() => {
          const target = pendingScroll.current;
          if (target === null) return;
          pendingScroll.current = null;
          scrollX.current = target;
          scrollRef.current?.scrollTo({ x: target, animated: false });
        }}
        horizontal
        onLayout={(event) => {
          viewportWidth.current = event.nativeEvent.layout.width;
          reveal(activeKey);
        }}
        onScroll={(event) => { scrollX.current = event.nativeEvent.contentOffset.x; }}
        ref={scrollRef}
        scrollEventThrottle={64}
        showsHorizontalScrollIndicator={false}
        style={styles.scroller}
      >
        {sessions.map((panel) => {
          const selected = !browserSelected && activeFileKey === null && panel.panelId === activePanelId;
          const renamable = selected && panel.kind !== 'collaboration' && onRenameSession !== undefined;
          const editing = rename.editing?.panelId === panel.panelId ? rename.editing : null;
          if (editing !== null) {
            return (
              <View
                key={panel.panelId}
                onLayout={remember(`panel:${panel.panelId}`)}
                style={[styles.tab, styles.tabSelected, styles.tabEditing]}
              >
                <KindIcon kind={panel.kind} size={15} theme={theme} />
                <TextInput
                  accessibilityLabel={t('窗口名称')}
                  autoFocus
                  editable={!editing.busy}
                  maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE}
                  maxLength={120}
                  onBlur={rename.cancel}
                  onChangeText={rename.change}
                  onSubmitEditing={rename.submit}
                  placeholder={t('留空恢复自动名称')}
                  placeholderTextColor={theme.colors.text3}
                  returnKeyType="done"
                  selectTextOnFocus
                  style={styles.renameInput}
                  submitBehavior="submit"
                  testID="tablet-tab-rename-input"
                  value={editing.draft}
                />
                {editing.busy ? <ActivityIndicator color={theme.colors.text2} size="small" /> : null}
                {editing.error !== null ? (
                  <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.renameError}>
                    {editing.error}
                  </Text>
                ) : null}
              </View>
            );
          }
          return (
            <MotionPressable
              accessibilityActions={renamable ? [{ name: 'rename', label: t('重命名') }] : undefined}
              accessibilityLabel={panelDisplayLabel(panel)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={panel.panelId}
              onAccessibilityAction={renamable
                ? (event) => {
                  if (event.nativeEvent.actionName === 'rename') rename.start(panel.panelId, panelDisplayLabel(panel));
                }
                : undefined}
              onLayout={remember(`panel:${panel.panelId}`)}
              onLongPress={renamable ? () => rename.start(panel.panelId, panelDisplayLabel(panel)) : undefined}
              onPress={() => onSelectSession(panel)}
              style={[styles.tab, selected ? styles.tabSelected : null]}
            >
              <KindIcon kind={panel.kind} size={15} theme={theme} />
              <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={[styles.label, selected ? styles.labelSelected : null]}>
                {panelDisplayLabel(panel)}
              </Text>
              {online && panelStatuses[panel.panelId] !== undefined ? (
                <PanelStatusLamp
                  label={panelStatusLabel(panelStatuses[panel.panelId]!)}
                  size={7}
                  testID={`tab-status-${panel.panelId}`}
                  theme={theme}
                  tone={lampTone(panelStatuses[panel.panelId]!)}
                />
              ) : null}
            </MotionPressable>
          );
        })}
        {files.map((tab) => {
          const key = tabletFileTabKey(tab);
          const selected = !browserSelected && key === activeFileKey;
          const name = tab.subPath.slice(tab.subPath.lastIndexOf('/') + 1);
          return (
            <MotionPressable
              accessibilityActions={[{ name: 'close', label: t('关闭 {name}', { name }) }]}
              accessibilityLabel={name}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={key}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'close') onCloseFile(tab);
              }}
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
        {browserTab !== null && browserKey !== null ? (
          <MotionPressable
            accessibilityActions={onCloseBrowser !== undefined
              ? [{ name: 'close', label: t('关闭 {name}', { name: browserTab.title }) }]
              : undefined}
            accessibilityLabel={browserTab.title}
            accessibilityRole="tab"
            accessibilityState={{ selected: browserSelected }}
            key={browserKey}
            onAccessibilityAction={onCloseBrowser !== undefined
              ? (event) => {
                if (event.nativeEvent.actionName === 'close') onCloseBrowser(browserTab);
              }
              : undefined}
            onLayout={remember(browserKey)}
            onPress={() => onSelectBrowser?.(browserTab)}
            style={[styles.tab, browserSelected ? styles.tabSelected : null]}
            testID="tablet-web-tab"
          >
            <KindIcon kind="web" size={15} theme={theme} />
            <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={[styles.label, browserSelected ? styles.labelSelected : null]}>
              {browserTab.title}
            </Text>
            <MotionPressable
              accessibilityLabel={t('关闭 {name}', { name: browserTab.title })}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => onCloseBrowser?.(browserTab)}
              style={styles.close}
            >
              <X color={theme.colors.text3} size={13} />
            </MotionPressable>
          </MotionPressable>
        ) : null}
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
    tabEditing: { maxWidth: 360 },
    renameInput: { minWidth: 140, maxWidth: 220, paddingVertical: 4, color: theme.colors.text, fontSize: 13 },
    renameError: { flexShrink: 1, maxWidth: 160, color: theme.colors.danger, fontSize: 12 },
  });
}
