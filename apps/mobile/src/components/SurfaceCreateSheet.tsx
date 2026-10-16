import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Check, ChevronDown, ChevronLeft, Folder, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  SessionWorkspaceSummary,
  SurfaceKind,
} from '../domain/session';
import {
  operationPresentation,
  type OperationPhase,
} from '../domain/operationPresentation';
import {
  surfaceCreateRowDetail,
  type SurfaceCreateRowDetail,
} from '../domain/surfaceCreateDetail';
import { useLoadingPresentation } from './useLoadingPresentation';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { KindIcon } from './KindIcon';
import { MotionPressable } from './MotionPressable';
import { OperationGlyph } from './OperationGlyph';
import { SheetStepTransition } from './SheetStepTransition';
import {
  SelectionIndicator,
  StableListExit,
  StableMotionRow,
  useStableListEntries,
} from './StableMotionList';
import { sheetHorizontalInset } from '../tablet/tabletLayout';
import { t } from '../i18n';
import {
  reanimatedReduceMotion,
  useReducedMotion,
} from '../theme/reducedMotion';

const SURFACES: ReadonlyArray<{
  kind: SurfaceKind;
  iconKind: SurfaceKind;
  label: string;
  detail: string;
}> = [
  { kind: 'claude', iconKind: 'claude', label: 'Claude', detail: '使用 Mac 端启动配置' },
  { kind: 'codex', iconKind: 'codex', label: 'Codex', detail: '使用 Mac 端启动配置' },
  { kind: 'shell', iconKind: 'shell', label: '终端', detail: '登录 Shell' },
  { kind: 'collaboration', iconKind: 'collaboration', label: '协作', detail: 'Claude 与 Codex' },
];

/** `static` falls back to the row's own description; the rest replace it. */
const SURFACE_CREATE_DETAIL_TEXT: Readonly<
  Partial<Record<SurfaceCreateRowDetail, string>>
> = Object.freeze({
  creating: '正在创建',
  opening: '正在打开项目',
  accepted: '电脑已接受，正在同步',
  ambiguous: '创建结果待确认',
  failed: '创建失败，可重试',
});

export interface SurfaceCreateSheetProps {
  workspaces: readonly SessionWorkspaceSummary[];
  initialWorkspaceCapability: string | null;
  preparing?: boolean;
  workspaceLocked?: boolean;
  status: OperationPhase;
  open: boolean;
  error: string | null;
  theme: ConnectTheme;
  onClose(): void;
  onCreate(workspaceCapability: string, kind: SurfaceKind): void;
}

export function SurfaceCreateSheet({
  workspaces,
  initialWorkspaceCapability,
  preparing = false,
  workspaceLocked = false,
  status,
  open,
  error,
  theme,
  onClose,
  onCreate,
}: SurfaceCreateSheetProps): React.ReactElement {
  const sheetRef = useRef<BottomSheetModal>(null);
  const presentedRef = useRef(false);
  const [choosingProject, setChoosingProject] = useState(false);
  const [selectedCapability, setSelectedCapability] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<SurfaceKind | null>(null);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const styles = createStyles(theme);
  const operation = operationPresentation(status);
  const creationBlocked = operation.busy || status === 'ambiguous';
  // Bands come from the shared loading vocabulary so this wait is described the
  // same way as every other one; `surfaceCreateRowDetail` explains the fencing.
  const creating = useLoadingPresentation(status === 'pending' && pendingKind !== null);
  const workspaceList = useStableListEntries(
    workspaces,
    (workspace) => workspace.workspaceCapability,
    reducedMotion,
  );
  const selectedWorkspace = useMemo(() => (
    workspaces.find((workspace) => workspace.workspaceCapability === selectedCapability)
    ?? workspaces.find((workspace) => workspace.workspaceCapability === initialWorkspaceCapability)
    ?? workspaces[0]
    ?? null
  ), [initialWorkspaceCapability, selectedCapability, workspaces]);

  useEffect(() => {
    if (open && !presentedRef.current) {
      setChoosingProject(false);
      setPendingKind(null);
      setSelectedCapability(initialWorkspaceCapability ?? workspaces[0]?.workspaceCapability ?? null);
      presentedRef.current = true;
      sheetRef.current?.present();
      return;
    }
    if (!open && presentedRef.current) sheetRef.current?.dismiss();
  }, [initialWorkspaceCapability, open, workspaces]);

  useEffect(() => {
    if (status === 'idle') setPendingKind(null);
  }, [status]);

  const renderBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      accessibilityLabel={t('轻点背景关闭新建窗口')}
      accessibilityRole="button"
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={1}
      pressBehavior="close"
      style={[props.style, styles.backdrop]}
    />
  );

  return (
    <BottomSheetModal
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      enableBlurKeyboardOnGesture={false}
      enableDynamicSizing
      enablePanDownToClose={!operation.busy}
      handleIndicatorStyle={styles.sheetHandle}
      maxDynamicContentSize={window.height * 0.76}
      keyboardBlurBehavior="none"
      onDismiss={() => {
        presentedRef.current = false;
        onClose();
      }}
      overrideReduceMotion={reanimatedReduceMotion(reducedMotion)}
      ref={sheetRef}
      stackBehavior="replace"
      style={{ marginHorizontal: sheetHorizontalInset(window.width) }}
    >
      <BottomSheetScrollView
        accessibilityViewIsModal
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, SPACE.x5) }}
        showsVerticalScrollIndicator={false}
        testID="surface-create-sheet-content"
      >
        <View style={styles.header}>
          {choosingProject ? (
            <MotionPressable
              accessibilityLabel={t('返回新建窗口')}
              accessibilityRole="button"
              onPress={() => setChoosingProject(false)}
              style={styles.iconButton}
            >
              <ChevronLeft color={theme.colors.text2} size={21} />
            </MotionPressable>
          ) : <View style={styles.iconButton} />}
          <Text style={styles.title}>{choosingProject ? t('选择项目') : t('新建窗口')}</Text>
          <MotionPressable
            accessibilityLabel={t('关闭新建窗口')}
            accessibilityRole="button"
            disabled={operation.busy}
            onPress={() => sheetRef.current?.dismiss()}
            style={styles.iconButton}
          >
            <X color={theme.colors.text2} size={20} />
          </MotionPressable>
        </View>

        <SheetStepTransition
          primary={(
            <>
            {workspaceLocked ? (
              <View
                accessible
                accessibilityLabel={t('当前项目 {label}', { label: selectedWorkspace?.label ?? t('没有可用项目') })}
                style={[styles.row, styles.projectRow]}
              >
                <Folder color={theme.colors.text2} size={20} />
                <View style={styles.copy}>
                  <Text style={styles.detail}>{t('项目')}</Text>
                  <Text numberOfLines={1} style={styles.label}>
                    {selectedWorkspace?.label ?? t('没有可用项目')}
                  </Text>
                </View>
              </View>
            ) : (
              <MotionPressable
                accessibilityLabel={t('选择项目')}
                accessibilityRole="button"
                disabled={creationBlocked || selectedWorkspace === null}
                onPress={() => setChoosingProject(true)}
                style={[styles.row, styles.projectRow]}
              >
                <Folder color={theme.colors.text2} size={20} />
                <View style={styles.copy}>
                  <Text style={styles.detail}>{t('项目')}</Text>
                  <Text numberOfLines={1} style={styles.label}>
                    {selectedWorkspace?.label ?? t('没有可用项目')}
                  </Text>
                </View>
                <ChevronDown color={theme.colors.text3} size={18} />
              </MotionPressable>
            )}
            {selectedWorkspace === null && preparing ? (
              <View accessibilityRole="progressbar" style={styles.preparing}>
                <ActivityIndicator color={theme.colors.accent} size="small" />
                <Text style={styles.detail}>{t('正在同步项目')}</Text>
              </View>
            ) : null}
            {SURFACES.map((surface) => (
              <MotionPressable
                accessibilityLabel={t('新建 {label}', { label: t(surface.label) })}
                accessibilityRole="button"
                disabled={creationBlocked || selectedWorkspace === null}
                key={surface.kind}
                onPress={() => {
                  if (selectedWorkspace) {
                    setPendingKind(surface.kind);
                    onCreate(selectedWorkspace.workspaceCapability, surface.kind);
                  }
                }}
                style={styles.row}
              >
                <View style={styles.kindFrame}>
                  <KindIcon kind={surface.iconKind} size={21} theme={theme} />
                </View>
                <View style={styles.copy}>
                  <Text style={styles.label}>{t(surface.label)}</Text>
                  <Text style={styles.detail}>
                    {t(SURFACE_CREATE_DETAIL_TEXT[surfaceCreateRowDetail({
                      status,
                      isPendingKind: pendingKind === surface.kind,
                      band: creating.band,
                      workspaceHasActiveSurfaces:
                        (selectedWorkspace?.activeSurfaceCount ?? 0) > 0,
                    })] ?? surface.detail)}
                  </Text>
                </View>
                <OperationGlyph
                  phase={pendingKind === surface.kind ? status : 'idle'}
                  size={19}
                  theme={theme}
                />
              </MotionPressable>
            ))}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
            </>
          )}
          primaryEstimatedHeight={
            72 + SURFACES.length * 56 + (selectedWorkspace === null && preparing ? 44 : 0)
            + (error ? 28 : 0)
          }
          reducedMotion={reducedMotion}
          secondary={workspaceList.entries.map((entry) => {
            if (entry.type === 'tombstone') {
              return (
                <StableListExit
                  height={56}
                  key={entry.key}
                  onComplete={() => workspaceList.finishExit(entry.id)}
                  reducedMotion={reducedMotion}
                  testID="surface-project-list-exit"
                />
              );
            }
            const workspace = entry.item;
            const selected = workspace.workspaceCapability === selectedWorkspace?.workspaceCapability;
            return (
              <StableMotionRow
                animateEnter={entry.entering}
                key={entry.key}
                reducedMotion={reducedMotion}
              >
                <MotionPressable
                  accessibilityLabel={t('选择项目 {label}', { label: workspace.label })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  feedback={selected ? undefined : 'selection'}
                  onPress={() => {
                    setSelectedCapability(workspace.workspaceCapability);
                    setChoosingProject(false);
                  }}
                  style={styles.row}
                >
                  <Folder color={theme.colors.text2} size={20} />
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={styles.label}>{workspace.label}</Text>
                    <Text style={styles.detail}>{t('{count} 个活动会话', { count: workspace.activeSurfaceCount })}</Text>
                  </View>
                  <SelectionIndicator
                    reducedMotion={reducedMotion}
                    selected={selected}
                    testID="surface-project-selection-indicator"
                  >
                    <Check color={theme.colors.accent} size={19} />
                  </SelectionIndicator>
                </MotionPressable>
              </StableMotionRow>
            );
          })}
          secondaryActive={choosingProject}
          secondaryEstimatedHeight={Math.max(56, workspaceList.entries.length * 56)}
        />
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    backdrop: { backgroundColor: theme.colors.overlay },
    sheetBackground: {
      borderTopWidth: 1,
      borderTopColor: theme.colors.line2,
      borderTopLeftRadius: RADIUS.sheet,
      borderTopRightRadius: RADIUS.sheet,
      backgroundColor: theme.colors.panel,
    },
    sheetHandle: { width: 36, height: 4, backgroundColor: theme.colors.line2 },
    header: {
      minHeight: 50,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
    },
    title: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    row: {
      minHeight: 56,
      paddingHorizontal: SPACE.x4,
      paddingVertical: SPACE.x2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x3,
    },
    projectRow: {
      marginHorizontal: SPACE.x3,
      marginVertical: SPACE.x2,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
    },
    kindFrame: {
      width: 34,
      height: 34,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    preparing: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x2,
    },
    copy: { minWidth: 0, flex: 1 },
    label: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
    detail: { color: theme.colors.text3, fontSize: 11, lineHeight: 16 },
    error: { marginHorizontal: SPACE.x4, marginTop: SPACE.x2, color: theme.colors.danger, fontSize: 12 },
  });
}
