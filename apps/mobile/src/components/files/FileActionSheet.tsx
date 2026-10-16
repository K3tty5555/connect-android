import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import {
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderPlus,
  Link,
  Pencil,
  Scissors,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parentMobileSubPath } from '../../../../../src/shared/mobileFileBoundary';
import type { FileClip } from '../../files/workspaceFileTree';
import type { ConnectTheme } from '../../theme/theme';
import { RADIUS, SPACE } from '../../theme/tokens';
import { reanimatedReduceMotion, useReducedMotion } from '../../theme/reducedMotion';
import { MotionPressable } from '../MotionPressable';
import type { FileTreeEntryRow } from './WorkspaceFileTree';
import { sheetHorizontalInset } from '../../tablet/tabletLayout';
import { t } from '../../i18n';

export type FileSheetTarget = { kind: 'root'; label: string } | { kind: 'entry'; row: FileTreeEntryRow };

export type FileSheetAction =
  | { type: 'createFile' | 'createDir'; dirSubPath: string; name: string }
  | { type: 'rename'; subPath: string; name: string }
  | { type: 'delete'; subPath: string; name: string; dir: boolean }
  | { type: 'copy' | 'cut'; subPath: string }
  | { type: 'paste'; dirSubPath: string }
  | { type: 'copyRelativePath'; subPath: string };

type NameStep = { mode: 'createFile' | 'createDir' | 'rename'; dirSubPath: string; subPath?: string };

/** 与 Mac `FileTree.tsx` 的 nameError、主进程 validateEntryName 同口径。 */
export function fileNameError(name: string): string | null {
  if (name.length === 0) return '名称不能为空';
  if (name.length > 255) return '名称过长（≤255 字符）';
  if (name !== name.trim()) return '名称首尾不能是空格';
  if (name.includes('/') || name.includes('\0')) return '名称不能包含 “/”';
  if (name === '.' || name === '..') return '不是合法名称';
  return null;
}

export function FileActionSheet({
  target,
  clip,
  canWrite,
  theme,
  onClose,
  onAction,
}: {
  target: FileSheetTarget | null;
  clip: FileClip | null;
  canWrite: boolean;
  theme: ConnectTheme;
  onClose(): void;
  /** 返回 Promise：名字步骤等待结果，失败时就地显示原因、不关闭。 */
  onAction(action: FileSheetAction): Promise<void>;
}): React.ReactElement {
  const sheetRef = useRef<BottomSheetModal>(null);
  const presentedRef = useRef(false);
  const [nameStep, setNameStep] = useState<NameStep | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const styles = createStyles(theme);

  useEffect(() => {
    if (target !== null && !presentedRef.current) {
      setNameStep(null);
      setName('');
      setError(null);
      setBusy(false);
      presentedRef.current = true;
      sheetRef.current?.present();
      return;
    }
    if (target === null && presentedRef.current) sheetRef.current?.dismiss();
  }, [target]);

  const row = target?.kind === 'entry' ? target.row : null;
  /** 对文件新建/粘贴落在其父目录（Mac 同口径）。 */
  const dirSubPath = row === null ? '' : row.dir ? row.subPath : parentMobileSubPath(row.subPath);
  const title = target === null ? '' : target.kind === 'root' ? target.label : target.row.name;

  const run = (action: FileSheetAction): void => {
    sheetRef.current?.dismiss();
    void onAction(action).catch(() => {});
  };

  const submitName = async (): Promise<void> => {
    if (nameStep === null || busy) return;
    const invalid = fileNameError(name);
    if (invalid !== null) {
      setError(t(invalid));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAction(nameStep.mode === 'rename'
        ? { type: 'rename', subPath: nameStep.subPath!, name }
        : { type: nameStep.mode, dirSubPath: nameStep.dirSubPath, name });
      sheetRef.current?.dismiss();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('操作没有完成，请重试。'));
    } finally {
      setBusy(false);
    }
  };

  const item = (
    key: string,
    Icon: LucideIcon,
    label: string,
    onPress: () => void,
    options: { write?: boolean; danger?: boolean; disabled?: boolean } = {},
  ): React.ReactElement => {
    const disabled = options.disabled === true || (options.write === true && !canWrite);
    const color = options.danger ? theme.colors.danger : theme.colors.text2;
    return (
      <MotionPressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        key={key}
        onPress={onPress}
        style={[styles.row, disabled ? styles.disabled : null]}
      >
        <Icon color={color} size={19} />
        <Text style={[styles.label, options.danger ? styles.danger : null]}>{label}</Text>
      </MotionPressable>
    );
  };

  const renderBackdrop = (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      accessibilityLabel={t('轻点背景关闭')}
      accessibilityRole="button"
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={1}
      pressBehavior={busy ? 'none' : 'close'}
      style={[props.style, styles.backdrop]}
    />
  );

  return (
    <BottomSheetModal
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      enableDynamicSizing
      enablePanDownToClose={!busy}
      handleIndicatorStyle={styles.sheetHandle}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      maxDynamicContentSize={window.height * 0.8}
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
        keyboardShouldPersistTaps="handled"
        testID="file-action-sheet"
      >
        <View style={styles.header}>
          <View style={styles.iconButton} />
          <Text numberOfLines={1} style={styles.title}>
            {nameStep === null
              ? title
              : nameStep.mode === 'rename' ? t('重命名') : nameStep.mode === 'createDir' ? t('新建文件夹') : t('新建文件')}
          </Text>
          <MotionPressable
            accessibilityLabel={t('关闭')}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => sheetRef.current?.dismiss()}
            style={styles.iconButton}
          >
            <X color={theme.colors.text2} size={20} />
          </MotionPressable>
        </View>
        {nameStep !== null ? (
          <View style={styles.nameStep}>
            <BottomSheetTextInput
              accessibilityLabel={t('名称')}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              editable={!busy}
              onChangeText={(value) => {
                setName(value);
                setError(null);
              }}
              onSubmitEditing={() => void submitName()}
              returnKeyType="done"
              style={styles.input}
              testID="file-name-input"
              value={name}
            />
            {error !== null ? <Text style={styles.error}>{error}</Text> : null}
            <MotionPressable
              accessibilityLabel={t('确定')}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || name.length === 0, busy }}
              disabled={busy || name.length === 0}
              onPress={() => void submitName()}
              style={[styles.confirm, busy || name.length === 0 ? styles.disabled : null]}
            >
              {busy
                ? <ActivityIndicator color={theme.colors.bg} size="small" />
                : <Text style={styles.confirmText}>{t('确定')}</Text>}
            </MotionPressable>
          </View>
        ) : (
          <View>
            {!canWrite ? <Text style={styles.note}>{t('这台手机只有查看权限，写操作需在电脑上授予。')}</Text> : null}
            {item('new-file', FilePlus, t('新建文件…'), () => {
              setNameStep({ mode: 'createFile', dirSubPath });
              setName('');
            }, { write: true })}
            {item('new-dir', FolderPlus, t('新建文件夹…'), () => {
              setNameStep({ mode: 'createDir', dirSubPath });
              setName('');
            }, { write: true })}
            {row !== null ? item('cut', Scissors, t('剪切'), () => run({ type: 'cut', subPath: row.subPath }), { write: true }) : null}
            {row !== null ? item('copy', Copy, t('复制'), () => run({ type: 'copy', subPath: row.subPath })) : null}
            {item('paste', ClipboardPaste, t('粘贴'), () => run({ type: 'paste', dirSubPath }), {
              write: true,
              disabled: clip === null,
            })}
            {row !== null ? item('copy-path', Link, t('复制相对路径'), () => run({ type: 'copyRelativePath', subPath: row.subPath })) : null}
            {row !== null ? item('rename', Pencil, t('重命名…'), () => {
              setNameStep({ mode: 'rename', dirSubPath, subPath: row.subPath });
              setName(row.name);
            }, { write: true }) : null}
            {row !== null ? item('delete', Trash2, t('删除'), () => run({
              type: 'delete', subPath: row.subPath, name: row.name, dir: row.dir,
            }), { write: true, danger: true }) : null}
          </View>
        )}
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
      minHeight: 52,
      paddingHorizontal: SPACE.x4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x3,
    },
    label: { color: theme.colors.text, fontSize: 15 },
    danger: { color: theme.colors.danger },
    disabled: { opacity: 0.4 },
    note: { color: theme.colors.text3, fontSize: 12, paddingHorizontal: SPACE.x4, paddingTop: SPACE.x3 },
    nameStep: { padding: SPACE.x4, gap: SPACE.x3 },
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      paddingHorizontal: SPACE.x3,
      color: theme.colors.text,
      backgroundColor: theme.colors.bg,
      fontSize: 15,
    },
    error: { color: theme.colors.danger, fontSize: 12 },
    confirm: {
      minHeight: 44,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.accent,
    },
    confirmText: { color: theme.colors.bg, fontSize: 15, fontWeight: '700' },
  });
}
