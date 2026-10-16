import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetFlatList,
  BottomSheetModal,
} from '@gorhom/bottom-sheet';
import {
  ChevronDown,
  ChevronLeft,
  Monitor,
  Plus,
  Smartphone,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  ConnectionState,
  OwnershipAuthority,
  OwnershipIntent,
  OwnershipState,
  SessionPanelSummary,
  SessionWorkspaceSummary,
} from '../domain/session';
import type { ConnectTheme } from '../theme/theme';
import {
  operationPresentation,
  type OperationPhase,
} from '../domain/operationPresentation';
import { MAX_COMPACT_FONT_SCALE, MOTION, RADIUS, SPACE } from '../theme/tokens';
import { KindIcon } from './KindIcon';
import { panelDisplayLabel } from '../domain/panelLabel';
import { MotionPressable } from './MotionPressable';
import { OperationGlyph } from './OperationGlyph';
import {
  ProgressiveRefreshButton,
  type RefreshStatus,
} from './ProgressiveRefreshButton';
import { t } from '../i18n';
import {
  reanimatedReduceMotion,
  useReducedMotion,
} from '../theme/reducedMotion';
import { insertExitTombstone } from '../domain/surfaceLifecycle';
import {
  StableMotionRow,
} from './StableMotionList';

export interface PanelSwitcherProps {
  panels: readonly SessionPanelSummary[];
  workspaces?: readonly SessionWorkspaceSummary[];
  activePanelId: string | null;
  connection: ConnectionState;
  quickKeysAvailable: boolean;
  quickKeysExpanded: boolean;
  theme: ConnectTheme;
  onSelect(panelId: string, workspaceCapability?: string): void;
  onRefresh(): void;
  refreshStatus?: RefreshStatus;
  sessionSwitchStatus?: OperationPhase;
  onQuickKeysToggle(): void;
  onNewSurface?(): void;
  canCreateSurface?: boolean;
  canPrepareSurface?: boolean;
  createSurfacePreparing?: boolean;
  canCloseActiveSurface?: boolean;
  closeSurfaceStatus?: OperationPhase;
  closingPanel?: SessionPanelSummary | null;
  closingPanelIndex?: number;
  onCloseExitComplete?(): void;
  onCloseActiveSurface?(): void;
  onBack?(): void;
  ownership?: OwnershipState | null;
  ownershipAuthority?: OwnershipAuthority;
  ownershipIntent?: OwnershipIntent | null;
  canControlInput?: boolean;
  onOwnershipIntent?(intent: OwnershipIntent): void;
  onOwnershipReconcile?(): void;
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  unpaired: '尚未绑定',
  online: '在线',
  confirming: '正在确认',
  reconnecting: '正在重连',
  offline: '离线',
};

const OWNERSHIP_LABELS: Record<Exclude<OwnershipAuthority, null>, string> = {
  desktop_owned: '电脑控制中',
  mobile_owned: '手机控制中',
  other_mobile_owned: '其他手机控制中',
};

type PanelSwitcherRow =
  | { type: 'workspace'; key: string; label: string }
  | { type: 'panel'; key: string; panel: SessionPanelSummary; workspaceLabel: string | null };

export function panelSwitcherRows(
  panels: readonly SessionPanelSummary[],
  workspaces: readonly SessionWorkspaceSummary[],
): PanelSwitcherRow[] {
  const workspaceLabelByCapability = new Map(workspaces.map((workspace) => [
    workspace.workspaceCapability,
    workspace.label,
  ]));
  for (const panel of panels) {
    if (panel.workspaceCapability !== undefined && !workspaceLabelByCapability.has(panel.workspaceCapability)) {
      workspaceLabelByCapability.set(panel.workspaceCapability, panel.workspaceLabel ?? t('项目'));
    }
  }
  const panelCapabilities = new Set(panels.flatMap((panel) => (
    panel.workspaceCapability === undefined ? [] : [panel.workspaceCapability]
  )));
  const capabilities = [
    ...workspaces
      .map((workspace) => workspace.workspaceCapability)
      .filter((capability) => panelCapabilities.has(capability)),
    ...[...panelCapabilities].filter((capability) => (
      !workspaces.some((workspace) => workspace.workspaceCapability === capability)
    )),
  ];
  const duplicateWorkspaceLabels = new Map<string, number>();
  for (const capability of capabilities) {
    const label = workspaceLabelByCapability.get(capability) ?? t('项目');
    duplicateWorkspaceLabels.set(label, (duplicateWorkspaceLabels.get(label) ?? 0) + 1);
  }
  const workspaceLabelIndexes = new Map<string, number>();
  const rows: PanelSwitcherRow[] = [];
  for (const capability of capabilities) {
    const baseLabel = workspaceLabelByCapability.get(capability) ?? t('项目');
    const index = (workspaceLabelIndexes.get(baseLabel) ?? 0) + 1;
    workspaceLabelIndexes.set(baseLabel, index);
    const duplicate = (duplicateWorkspaceLabels.get(baseLabel) ?? 0) > 1;
    const displayLabel = duplicate ? `${baseLabel} · ${index}` : baseLabel;
    rows.push({ type: 'workspace', key: `workspace:${capability}`, label: displayLabel });
    for (const panel of panels) {
      if (panel.workspaceCapability === capability) {
        rows.push({
          type: 'panel',
          key: `panel:${capability}:${panel.panelId}`,
          panel,
          workspaceLabel: displayLabel,
        });
      }
    }
  }
  const unscopedPanels = panels.filter((panel) => panel.workspaceCapability === undefined);
  if (unscopedPanels.length > 0) {
    if (rows.length > 0) {
      rows.push({ type: 'workspace', key: 'workspace:unscoped', label: t('其他会话') });
    }
    for (const panel of unscopedPanels) {
      rows.push({
        type: 'panel',
        key: `panel:unscoped:${panel.panelId}`,
        panel,
        workspaceLabel: null,
      });
    }
  }
  return rows;
}

export function PanelSwitcher({
  panels,
  workspaces = [],
  activePanelId,
  connection,
  theme,
  onSelect,
  onRefresh,
  refreshStatus = 'idle',
  sessionSwitchStatus = 'idle',
  onNewSurface = () => {},
  canCreateSurface = false,
  canPrepareSurface = false,
  createSurfacePreparing = false,
  canCloseActiveSurface = false,
  closeSurfaceStatus = 'idle',
  closingPanel = null,
  closingPanelIndex = -1,
  onCloseExitComplete = () => {},
  onCloseActiveSurface = () => {},
  onBack,
  ownership = null,
  ownershipAuthority = ownership === 'desktop_owned'
    || ownership === 'mobile_owned'
    || ownership === 'other_mobile_owned'
    ? ownership
    : null,
  ownershipIntent = null,
  canControlInput = false,
  onOwnershipIntent = () => {},
  onOwnershipReconcile,
}: PanelSwitcherProps): React.ReactElement {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const styles = createStyles(theme);
  const exitOpacity = useRef(new Animated.Value(1)).current;
  const exitOffset = useRef(new Animated.Value(0)).current;
  const onCloseExitCompleteRef = useRef(onCloseExitComplete);
  onCloseExitCompleteRef.current = onCloseExitComplete;
  const closingRemoved = closingPanel !== null
    && !panels.some((panel) => panel.panelId === closingPanel.panelId);
  const visualPanels = insertExitTombstone(panels, closingPanel, closingPanelIndex);
  const exitingPanelId = closingRemoved ? closingPanel.panelId : null;
  const activePanel = panels.find((panel) => panel.panelId === activePanelId)
    ?? panels[0]
    ?? null;
  const activeLabel = activePanel ? panelDisplayLabel(activePanel) : t('会话');
  const activeKind = activePanel?.kind ?? 'shell';
  const groupedRows = panelSwitcherRows(visualPanels, workspaces);
  const groupedKeys = groupedRows.map((row) => row.key);
  const groupedKeySignature = JSON.stringify(groupedKeys);
  const previousGroupedKeys = useRef(groupedKeys);
  const priorGroupedKeySet = new Set(previousGroupedKeys.current);
  const enteringGroupedKeys = new Set(groupedKeys.filter((key) => !priorGroupedKeySet.has(key)));
  useLayoutEffect(() => {
    previousGroupedKeys.current = groupedKeys;
  }, [groupedKeySignature]);
  const ownershipPending = ownership === 'takeover_pending'
    || ownership === 'return_pending';
  const ownershipAmbiguous = ownership === 'reconciling';
  const ownershipPhase: OperationPhase = ownershipPending
    ? 'pending'
    : ownershipAmbiguous ? 'ambiguous' : 'idle';
  const closePresentation = operationPresentation(closeSurfaceStatus);
  const closeBlocked = !canCloseActiveSurface
    || closePresentation.busy
    || closeSurfaceStatus === 'ambiguous';
  const ownershipLabel = ownershipAuthority === null
    ? null
    : canControlInput
      ? t(OWNERSHIP_LABELS[ownershipAuthority])
      : t('只读 · {ownership}', { ownership: t(OWNERSHIP_LABELS[ownershipAuthority]) });

  useEffect(() => {
    exitOpacity.stopAnimation();
    exitOffset.stopAnimation();
    exitOpacity.setValue(1);
    exitOffset.setValue(0);
    if (!closingRemoved) return;
    if (reducedMotion) {
      onCloseExitCompleteRef.current();
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(exitOpacity, {
        duration: MOTION.fast02,
        easing: Easing.bezier(0.2, 0, 0.38, 0.9),
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.timing(exitOffset, {
        duration: MOTION.fast02,
        easing: Easing.bezier(0.2, 0, 0.38, 0.9),
        toValue: 4,
        useNativeDriver: true,
      }),
    ]);
    animation.start(({ finished }) => {
      if (finished) onCloseExitCompleteRef.current();
    });
    return () => animation.stop();
  }, [closingRemoved, exitingPanelId, exitOffset, exitOpacity, reducedMotion]);

  const openSheet = (): void => {
    setSheetOpen(true);
    sheetRef.current?.present();
  };
  const closeSheet = (): void => {
    setSheetOpen(false);
    sheetRef.current?.dismiss();
  };
  const select = (panel: SessionPanelSummary): void => {
    closeSheet();
    if (panel.panelId !== activePanelId) {
      if (panel.workspaceCapability === undefined) onSelect(panel.panelId);
      else onSelect(panel.panelId, panel.workspaceCapability);
    }
  };
  const renderBackdrop = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      accessibilityLabel={t('轻点背景关闭终端会话列表')}
      accessibilityRole="button"
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={1}
      pressBehavior="close"
      style={[props.style, styles.backdrop]}
    />
  ), [styles.backdrop]);

  // 刷新是对这份列表的操作，放在列表头部；导航栏只留返回、标题、控制权与新建。
  const sheetHeader = (
    <View>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{t('会话列表')}</Text>
        <View style={styles.sheetHeaderActions}>
          <ProgressiveRefreshButton
            idleLabel={t('刷新会话列表')}
            pendingLabel={t('正在刷新会话列表')}
            onRefresh={onRefresh}
            size={19}
            status={refreshStatus}
            style={styles.iconButton}
            theme={theme}
          />
          <MotionPressable
            accessibilityLabel={t('关闭终端会话列表')}
            accessibilityRole="button"
            onPress={closeSheet}
            style={styles.closeButton}
          >
            <X color={theme.colors.text2} size={20} />
          </MotionPressable>
        </View>
      </View>
    </View>
  );
  const OwnershipIcon = ownershipIntent === 'return_to_desktop' ? Monitor : Smartphone;

  return (
    <View style={styles.container} testID="panel-switcher">
      {onBack ? (
        <MotionPressable
          accessibilityLabel={t('返回项目')}
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
        >
          <ChevronLeft color={theme.colors.text2} size={21} />
        </MotionPressable>
      ) : null}
      <MotionPressable
        accessibilityLabel={sessionSwitchStatus === 'pending'
          ? t('正在切换到 {label}', { label: activeLabel })
          : sessionSwitchStatus === 'failed'
            ? t('切换到 {label}失败', { label: activeLabel })
            : t('切换会话，当前 {label}', { label: activeLabel })}
        accessibilityRole="button"
        accessibilityState={{
          expanded: sheetOpen,
          ...(sessionSwitchStatus === 'pending' ? { busy: true } : {}),
        }}
        onPress={openSheet}
        style={styles.selector}
      >
        <KindIcon kind={activeKind} size={19} theme={theme} />
        <View style={styles.selectorCopy}>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.activeLabel}>{activeLabel}</Text>
          <View style={styles.detailRow}>
            <View
              style={[
                styles.statusDot,
                connection === 'online' ? styles.statusDotOnline : null,
                connection === 'confirming' || connection === 'reconnecting'
                  ? styles.statusDotReconnecting
                  : null,
              ]}
            />
            <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.connection}>{t(CONNECTION_LABELS[connection])}</Text>
            {ownershipLabel ? (
              <>
                <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.connection}>·</Text>
                <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.ownershipLabel}>
                  {ownershipLabel}
                </Text>
              </>
            ) : null}
          </View>
        </View>
        <OperationGlyph
          phase={sessionSwitchStatus}
          size={15}
          testID="session-switch-status"
          theme={theme}
        />
        <ChevronDown color={theme.colors.text3} size={17} />
      </MotionPressable>

      {ownershipIntent || ownershipPending || ownershipAmbiguous ? (
        <MotionPressable
          accessibilityLabel={ownershipAmbiguous
            ? t('重新确认控制权')
            : ownershipPending
            ? ownership === 'return_pending'
              ? t('正在归还电脑输入')
              : t('正在接管电脑输入')
            : ownershipIntent === 'return_to_desktop'
              ? t('归还电脑输入')
              : t('接管电脑输入')}
          accessibilityRole="button"
          accessibilityState={{
            busy: ownershipPending,
            disabled: ownershipPending || (ownershipAmbiguous && !onOwnershipReconcile),
          }}
          disabled={ownershipPending || (ownershipAmbiguous && !onOwnershipReconcile)}
          onPress={() => {
            if (ownershipAmbiguous) onOwnershipReconcile?.();
            else if (ownershipIntent) onOwnershipIntent(ownershipIntent);
          }}
          style={styles.ownershipAction}
        >
          <View style={styles.ownershipPill}>
            {ownershipPhase === 'idle' ? (
              <>
                <OwnershipIcon color={theme.colors.accent} size={14} />
                <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.ownershipActionText}>
                  {ownershipIntent === 'return_to_desktop' ? t('归还') : t('接管')}
                </Text>
              </>
            ) : <OperationGlyph phase={ownershipPhase} size={16} theme={theme} />}
          </View>
        </MotionPressable>
      ) : null}

      <MotionPressable
        accessibilityLabel={createSurfacePreparing ? t('正在恢复新建窗口功能') : t('新建窗口')}
        accessibilityRole="button"
        accessibilityState={{
          busy: createSurfacePreparing,
          disabled: !canCreateSurface && !canPrepareSurface,
        }}
        disabled={createSurfacePreparing || (!canCreateSurface && !canPrepareSurface)}
        onPress={onNewSurface}
        style={[
          styles.iconButton,
          !canCreateSurface && !canPrepareSurface ? styles.disabled : null,
        ]}
      >
        <OperationGlyph
          idle={<Plus color={theme.colors.text2} size={21} />}
          phase={createSurfacePreparing ? 'pending' : 'idle'}
          size={20}
          theme={theme}
        />
      </MotionPressable>

      <BottomSheetModal
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.sheetBackground}
        enableBlurKeyboardOnGesture={false}
        enableDynamicSizing
        enablePanDownToClose
        handleIndicatorStyle={styles.sheetHandle}
        keyboardBlurBehavior="none"
        maxDynamicContentSize={window.height * 0.76}
        onDismiss={() => setSheetOpen(false)}
        overrideReduceMotion={reanimatedReduceMotion(reducedMotion)}
        ref={sheetRef}
        stackBehavior="replace"
      >
        <BottomSheetFlatList
          accessibilityViewIsModal
          contentContainerStyle={[
            styles.sheetContent,
            { paddingBottom: Math.max(insets.bottom, SPACE.x4) },
          ]}
          data={groupedRows}
          keyExtractor={(row) => row.key}
          ListEmptyComponent={(
            <Text style={styles.empty}>{t('当前没有可用会话')}</Text>
          )}
          ListHeaderComponent={sheetHeader}
          renderItem={({ item }) => {
            if (item.type === 'workspace') {
              return (
                <StableMotionRow
                  animateEnter={enteringGroupedKeys.has(item.key)}
                  reducedMotion={reducedMotion}
                >
                  <Text style={styles.workspaceSection}>{item.label}</Text>
                </StableMotionRow>
              );
            }
            const panel = item.panel;
            if (panel.panelId === exitingPanelId) {
              return (
                <Animated.View
                  accessible={false}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  pointerEvents="none"
                  style={[
                    styles.panelExitTombstone,
                    { opacity: exitOpacity, transform: [{ translateX: exitOffset }] },
                  ]}
                  testID="panel-exit-tombstone"
                />
              );
            }
            const selected = panel.panelId === activePanelId;
            return (
              <StableMotionRow
                animateEnter={enteringGroupedKeys.has(item.key)}
                reducedMotion={reducedMotion}
                testID="panel-motion-row"
              >
                <View
                  style={[
                    styles.panelRow,
                    selected ? styles.panelRowSelected : null,
                  ]}
                >
                  <MotionPressable
                    accessibilityLabel={item.workspaceLabel
                      ? `${item.workspaceLabel}，${panelDisplayLabel(panel)}`
                      : panelDisplayLabel(panel)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    feedback={selected ? undefined : 'selection'}
                    onPress={() => select(panel)}
                    style={styles.panelSelector}
                  >
                    <KindIcon kind={panel.kind} size={20} theme={theme} />
                    <View style={styles.panelCopy}>
                      <Text numberOfLines={1} style={styles.panelLabel}>{panelDisplayLabel(panel)}</Text>
                    </View>
                    {/*
                      这里原本有一个选中态对勾。现网反馈「关闭左边的对勾按钮没有实际
                      意义」——它确实没有：`SelectionIndicator` 只是个动画透明度容器，
                      不可按，点它等于点整行。而它紧挨着关闭用的 X，选中行上就呈现为
                      并排的「✓ ✕」，被读成两个按钮。选中态本来就由行背景
                      `panelRowSelected` 和行按钮的 `accessibilityState={{ selected }}`
                      表达（VoiceOver 读的是后者），对勾纯属冗余装饰，故移除。
                    */}
                  </MotionPressable>
                  <View style={styles.panelCloseSlot} testID="panel-close-slot">
                    {selected && panel.kind !== 'collaboration' ? (
                      <MotionPressable
                        accessibilityLabel={t('关闭窗口 {label}', { label: panelDisplayLabel(panel) })}
                        accessibilityRole="button"
                        accessibilityState={{
                          busy: closePresentation.busy,
                          disabled: closeBlocked,
                        }}
                        disabled={closeBlocked}
                        onPress={onCloseActiveSurface}
                        style={[
                          styles.panelCloseButton,
                          closeBlocked ? styles.disabled : null,
                        ]}
                      >
                        <OperationGlyph
                          idle={<X color={theme.colors.danger} size={19} />}
                          phase={closeSurfaceStatus}
                          size={19}
                          transientSuccessMs={1_200}
                          theme={theme}
                        />
                      </MotionPressable>
                    ) : null}
                  </View>
                </View>
              </StableMotionRow>
            );
          }}
          showsVerticalScrollIndicator={false}
          testID="panel-switcher-sheet-content"
        />
      </BottomSheetModal>
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      minHeight: 50,
      paddingLeft: SPACE.x3,
      paddingRight: SPACE.x1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      backgroundColor: theme.colors.panel,
      flexDirection: 'row',
      alignItems: 'center',
    },
    selector: {
      minWidth: 0,
      minHeight: 48,
      flex: 1,
      paddingRight: SPACE.x2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectorCopy: {
      minWidth: 0,
      flex: 1,
      justifyContent: 'center',
    },
    activeLabel: {
      color: theme.colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    detailRow: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x1,
    },
    statusDot: {
      width: 6,
      height: 6,
      flex: 0,
      borderRadius: RADIUS.pill,
      backgroundColor: theme.colors.text3,
    },
    statusDotOnline: { backgroundColor: theme.colors.ok },
    statusDotReconnecting: { backgroundColor: theme.colors.warn },
    connection: {
      flex: 0,
      color: theme.colors.text3,
      fontSize: 10.5,
    },
    ownershipLabel: {
      minWidth: 0,
      flexShrink: 1,
      color: theme.colors.text2,
      fontSize: 10.5,
    },
    ownershipAction: {
      minWidth: 52,
      height: 44,
      flex: 0,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ownershipPill: {
      minWidth: 56,
      height: 30,
      paddingHorizontal: SPACE.x2 + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.pill,
      backgroundColor: theme.colors.panel2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x1,
    },
    ownershipActionText: {
      color: theme.colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconButtonActive: { backgroundColor: theme.colors.panel2 },
    disabled: { opacity: 0.4 },
    backdrop: { backgroundColor: theme.colors.overlay },
    sheetBackground: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.line2,
      borderTopLeftRadius: RADIUS.sheet,
      borderTopRightRadius: RADIUS.sheet,
      backgroundColor: theme.colors.panel,
    },
    sheetHandle: {
      width: 36,
      height: 4,
      backgroundColor: theme.colors.line2,
    },
    sheetContent: { paddingHorizontal: SPACE.x3 },
    workspaceSection: {
      paddingHorizontal: SPACE.x2,
      paddingTop: SPACE.x3,
      paddingBottom: SPACE.x1,
      color: theme.colors.text3,
      fontSize: 11,
      fontWeight: '700',
    },
    sheetHeader: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sheetHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    sheetTitle: {
      paddingLeft: SPACE.x2,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    closeButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    panelRow: {
      minHeight: 52,
      paddingHorizontal: SPACE.x2,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
    },
    panelExitTombstone: {
      minHeight: 52,
      marginHorizontal: SPACE.x2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      backgroundColor: theme.colors.panel2,
    },
    panelRowSelected: { backgroundColor: theme.colors.panel2 },
    panelSelector: {
      minWidth: 0,
      minHeight: 52,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x3,
    },
    panelCloseButton: {
      width: 44,
      height: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    panelCloseSlot: {
      width: 44,
      height: 44,
      marginLeft: SPACE.x1,
      flex: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    panelLabel: {
      color: theme.colors.text2,
      fontSize: 14,
      fontWeight: '600',
    },
    panelCopy: { minWidth: 0, flex: 1 },
    workspaceLabel: { marginTop: 1, color: theme.colors.text3, fontSize: 11 },
    empty: {
      minHeight: 64,
      paddingHorizontal: SPACE.x2,
      color: theme.colors.text3,
      fontSize: 13,
      textAlignVertical: 'center',
    },
  });
}
