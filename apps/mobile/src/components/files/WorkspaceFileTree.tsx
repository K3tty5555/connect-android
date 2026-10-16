import { useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Ellipsis } from 'lucide-react-native';
import { FileIcon } from '../../files/fileIcon';
import type { FileTreeRow, WorkspaceFileTreeStore } from '../../files/workspaceFileTree';
import type { ConnectTheme } from '../../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../../theme/tokens';
import { MotionPressable } from '../MotionPressable';
import { t } from '../../i18n';

export type FileTreeEntryRow = Extract<FileTreeRow, { type: 'entry' }>;

const INDENT = 16;

/**
 * 与 Mac 资源管理器同形的层级树：文件夹在前、点开头半透明、被剪切的半透明更深。
 * 轻点：文件夹展开/收起，文件打开；长按或行尾「⋯」：条目操作（VoiceOver 走自定义动作）。
 */
export function WorkspaceFileTree({
  store,
  theme,
  selectedSubPath = null,
  refreshing = false,
  onOpenFile,
  onEntryMenu,
  onRefresh,
  header,
}: {
  store: WorkspaceFileTreeStore;
  theme: ConnectTheme;
  selectedSubPath?: string | null;
  refreshing?: boolean;
  onOpenFile(row: FileTreeEntryRow): void;
  onEntryMenu(row: FileTreeEntryRow): void;
  onRefresh(): void;
  header?: React.ReactElement | null;
}): React.ReactElement {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const styles = createStyles(theme);
  return (
    <FlatList
      contentContainerStyle={[styles.list, snapshot.rows.length === 0 ? styles.listEmpty : null]}
      data={snapshot.rows}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={header ?? null}
      ListEmptyComponent={(
        <View style={styles.empty}>
          {snapshot.rootStatus === 'error' ? (
            <Text style={styles.emptyText}>{snapshot.rootError ?? t('无法读取目录')}</Text>
          ) : snapshot.rootStatus === 'ready' ? (
            <Text style={styles.emptyText}>{t('空文件夹')}</Text>
          ) : (
            <ActivityIndicator accessibilityLabel={t('正在读取文件')} color={theme.colors.text3} />
          )}
        </View>
      )}
      refreshControl={(
        <RefreshControl onRefresh={onRefresh} refreshing={refreshing} tintColor={theme.colors.text3} />
      )}
      renderItem={({ item: row }) => {
        if (row.type === 'status') {
          return (
            <View style={[styles.statusRow, { paddingLeft: SPACE.x3 + (row.depth * INDENT) + 22 }]}>
              {row.status === 'loading' ? (
                <ActivityIndicator color={theme.colors.text3} size="small" />
              ) : (
                <Text numberOfLines={2} style={[styles.statusText, row.status === 'error' ? styles.errorText : null]}>
                  {row.status === 'empty'
                    ? t('空文件夹')
                    : row.status === 'truncated'
                      ? t('只显示前 1000 项')
                      : row.message ?? t('无法读取目录')}
                </Text>
              )}
            </View>
          );
        }
        const selected = row.subPath === selectedSubPath;
        return (
          <MotionPressable
            accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: t('更多操作') }]}
            accessibilityLabel={row.dir
              ? t('文件夹 {name}', { name: row.name })
              : t('文件 {name}', { name: row.name })}
            accessibilityRole="button"
            accessibilityState={row.dir ? { expanded: row.expanded, selected } : { selected }}
            delayLongPress={350}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'longpress') onEntryMenu(row);
              else if (row.dir) store.toggle(row.subPath);
              else onOpenFile(row);
            }}
            onLongPress={() => onEntryMenu(row)}
            onPress={() => (row.dir ? store.toggle(row.subPath) : onOpenFile(row))}
            style={[
              styles.row,
              selected ? styles.rowSelected : null,
              { paddingLeft: SPACE.x2 + (row.depth * INDENT) },
            ]}
            testID={`file-row-${row.subPath}`}
          >
            <View style={styles.chevronSlot}>
              {row.dir ? (
                <View style={row.expanded ? styles.chevronOpen : null}>
                  <ChevronRight color={theme.colors.text3} size={14} />
                </View>
              ) : null}
            </View>
            <View style={[styles.rowBody, row.hidden ? styles.hidden : null, row.cut ? styles.cut : null]}>
              <FileIcon dir={row.dir} expanded={row.expanded} name={row.name} size={17} theme={theme.mode} />
              <Text
                maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE}
                numberOfLines={1}
                style={styles.name}
              >
                {row.name}
              </Text>
            </View>
            <MotionPressable
              accessibilityElementsHidden
              hitSlop={6}
              importantForAccessibility="no-hide-descendants"
              onPress={() => onEntryMenu(row)}
              style={styles.more}
            >
              <Ellipsis color={theme.colors.text3} size={16} />
            </MotionPressable>
          </MotionPressable>
        );
      }}
      showsVerticalScrollIndicator={false}
    />
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    list: { paddingVertical: SPACE.x1, paddingBottom: SPACE.x6 },
    listEmpty: { flexGrow: 1 },
    empty: { flex: 1, minHeight: 160, alignItems: 'center', justifyContent: 'center', padding: SPACE.x4 },
    emptyText: { color: theme.colors.text3, fontSize: 13, textAlign: 'center' },
    row: {
      minHeight: 40,
      paddingRight: SPACE.x1,
      marginHorizontal: SPACE.x1,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
    },
    rowSelected: { backgroundColor: theme.colors.panel2 },
    chevronSlot: { width: 18, alignItems: 'center', justifyContent: 'center' },
    chevronOpen: { transform: [{ rotate: '90deg' }] },
    rowBody: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACE.x2 },
    name: { minWidth: 0, flex: 1, color: theme.colors.text, fontSize: 14 },
    hidden: { opacity: 0.55 },
    cut: { opacity: 0.4 },
    more: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    statusRow: { minHeight: 32, justifyContent: 'center', paddingRight: SPACE.x3 },
    statusText: { color: theme.colors.text3, fontSize: 12 },
    errorText: { color: theme.colors.danger },
  });
}
