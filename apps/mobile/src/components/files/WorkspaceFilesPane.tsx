import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ellipsis, X } from 'lucide-react-native';
import { WorkspaceFileError, type WorkspaceFileTransport } from '../../domain/workspaceFiles';
import { pruneWorkspaceFileClips, WorkspaceFileTreeStore } from '../../files/workspaceFileTree';
import type { ConnectTheme } from '../../theme/theme';
import { RADIUS, SPACE } from '../../theme/tokens';
import { MotionPressable } from '../MotionPressable';
import { FileActionSheet, type FileSheetAction, type FileSheetTarget } from './FileActionSheet';
import { WorkspaceFileTree, type FileTreeEntryRow } from './WorkspaceFileTree';
import { t } from '../../i18n';

/** 每个 transport 下按项目复用同一棵树：切页、iPad 横竖屏重排都不丢展开状态；重连轮换后重新载入。 */
const stores = new WeakMap<WorkspaceFileTransport, Map<string, WorkspaceFileTreeStore>>();

export function workspaceFileTreeStore(
  transport: WorkspaceFileTransport,
  workspaceCapability: string,
): WorkspaceFileTreeStore {
  let byWorkspace = stores.get(transport);
  if (byWorkspace === undefined) {
    byWorkspace = new Map();
    stores.set(transport, byWorkspace);
  }
  let store = byWorkspace.get(workspaceCapability);
  if (store === undefined) {
    store = new WorkspaceFileTreeStore(workspaceCapability, transport);
    byWorkspace.set(workspaceCapability, store);
  }
  return store;
}

/** 目录更新后丢掉已不存在的 capability 对应的树与剪贴状态（重连轮换会不断产生新的）。 */
export function pruneWorkspaceFileTreeStores(
  transport: WorkspaceFileTransport,
  liveCapabilities: ReadonlySet<string>,
): void {
  const byWorkspace = stores.get(transport);
  if (byWorkspace !== undefined) {
    for (const capability of [...byWorkspace.keys()]) {
      if (!liveCapabilities.has(capability)) byWorkspace.delete(capability);
    }
  }
  pruneWorkspaceFileClips(liveCapabilities);
}

/**
 * 项目文件面板：文件树 + 条目操作（与 Mac 资源管理器右键菜单同一组操作）。
 * iPhone 项目页的「文件」分段与 iPad 侧栏共用。
 */
export function WorkspaceFilesPane({
  transport,
  workspaceCapability,
  workspaceLabel,
  online,
  canWrite,
  theme,
  selectedSubPath = null,
  onOpenFile,
  onFileRemoved,
}: {
  transport: WorkspaceFileTransport;
  workspaceCapability: string;
  workspaceLabel: string;
  online: boolean;
  canWrite: boolean;
  theme: ConnectTheme;
  selectedSubPath?: string | null;
  onOpenFile(subPath: string): void;
  /** 删除或重命名后，宿主据此关闭指向旧路径的查看器。 */
  onFileRemoved?(subPath: string): void;
}): React.ReactElement {
  const store = useMemo(
    () => workspaceFileTreeStore(transport, workspaceCapability),
    [transport, workspaceCapability],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [target, setTarget] = useState<FileSheetTarget | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const styles = createStyles(theme);

  useEffect(() => {
    if (!online) return;
    if (snapshot.rootStatus === 'idle') store.ensureRoot();
    else if (snapshot.rootStatus === 'error') void store.refreshAll();
    // 只在恢复在线时补载；rootStatus 变化本身不重复触发。
  }, [online, store]);

  const report = (error: unknown): void => {
    if (error instanceof WorkspaceFileError && error.category === 'ambiguous') {
      setBanner(t('结果无法确认，已刷新目录，请核对后再操作。'));
      return;
    }
    setBanner(error instanceof Error ? error.message : t('操作没有完成，请重试。'));
  };

  const perform = async (action: FileSheetAction): Promise<void> => {
    setBanner(null);
    switch (action.type) {
      case 'copy':
      case 'cut':
        store.setClip({ subPath: action.subPath, mode: action.type });
        return;
      case 'copyRelativePath':
        await Clipboard.setStringAsync(action.subPath);
        return;
      case 'paste':
        try {
          await store.paste(action.dirSubPath);
        } catch (error) {
          report(error);
        }
        return;
      case 'delete':
        Alert.alert(
          action.dir ? t('删除文件夹「{name}」？', { name: action.name }) : t('删除「{name}」？', { name: action.name }),
          t('将移到电脑的废纸篓。'),
          [
            { text: t('取消'), style: 'cancel' },
            {
              text: t('删除'),
              style: 'destructive',
              onPress: () => {
                void store.remove(action.subPath).then(
                  () => onFileRemoved?.(action.subPath),
                  report,
                );
              },
            },
          ],
        );
        return;
      case 'createFile':
        await store.createFile(action.dirSubPath, action.name);
        return;
      case 'createDir':
        await store.createDir(action.dirSubPath, action.name);
        return;
      case 'rename':
        await store.rename(action.subPath, action.name);
        onFileRemoved?.(action.subPath);
        return;
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        <Text numberOfLines={1} style={styles.toolbarTitle}>{t('资源管理器')}</Text>
        <MotionPressable
          accessibilityLabel={t('项目根目录操作')}
          accessibilityRole="button"
          disabled={!online}
          onPress={() => setTarget({ kind: 'root', label: workspaceLabel })}
          style={[styles.toolbarButton, !online ? styles.disabled : null]}
        >
          <Ellipsis color={theme.colors.text2} size={18} />
        </MotionPressable>
      </View>
      {banner !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
          <MotionPressable
            accessibilityLabel={t('关闭提示')}
            accessibilityRole="button"
            onPress={() => setBanner(null)}
            style={styles.bannerClose}
          >
            <X color={theme.colors.text3} size={15} />
          </MotionPressable>
        </View>
      ) : null}
      <WorkspaceFileTree
        onEntryMenu={(row: FileTreeEntryRow) => setTarget({ kind: 'entry', row })}
        onOpenFile={(row) => onOpenFile(row.subPath)}
        onRefresh={() => {
          setRefreshing(true);
          void store.refreshAll().finally(() => setRefreshing(false));
        }}
        refreshing={refreshing}
        selectedSubPath={selectedSubPath}
        store={store}
        theme={theme}
      />
      <FileActionSheet
        canWrite={canWrite && online}
        clip={snapshot.clip}
        onAction={async (action) => {
          try {
            await perform(action);
          } catch (error) {
            // 名字步骤自己就地展示；其余操作走横幅。
            if (action.type === 'createFile' || action.type === 'createDir' || action.type === 'rename') {
              if (error instanceof WorkspaceFileError && error.category === 'ambiguous') report(error);
              throw error;
            }
            report(error);
          }
        }}
        onClose={() => setTarget(null)}
        target={target}
        theme={theme}
      />
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    // 不自带底色：iPhone 项目页与 iPad 侧栏各用宿主的面板色。
    root: { flex: 1 },
    toolbar: {
      minHeight: 40,
      paddingLeft: SPACE.x4,
      paddingRight: SPACE.x1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    toolbarTitle: {
      flex: 1,
      color: theme.colors.text3,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
    },
    toolbarButton: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    disabled: { opacity: 0.45 },
    banner: {
      marginHorizontal: SPACE.x3,
      marginBottom: SPACE.x2,
      paddingLeft: SPACE.x3,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      backgroundColor: theme.colors.panel,
      flexDirection: 'row',
      alignItems: 'center',
    },
    bannerText: { flex: 1, color: theme.colors.text2, fontSize: 12, paddingVertical: SPACE.x2 },
    bannerClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  });
}
