import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotionPressable } from '../components/MotionPressable';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';

/** iPad 主区没有打开会话或文件时的安静占位（AGENTS §5.8：最多一行 + 一个动作）。 */
export function TabletEmptyState({
  theme,
  title,
  actionLabel,
  onAction,
}: {
  theme: ConnectTheme;
  title: string;
  actionLabel?: string;
  onAction?(): void;
}): React.ReactElement {
  const styles = createStyles(theme);
  return (
    <SafeAreaView edges={['right', 'bottom']} style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        {actionLabel !== undefined && onAction !== undefined ? (
          <MotionPressable accessibilityRole="button" onPress={onAction} style={styles.action}>
            <Text style={styles.actionText}>{actionLabel}</Text>
          </MotionPressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SPACE.x4, padding: SPACE.x5 },
    title: { color: theme.colors.text3, fontSize: 15, textAlign: 'center' },
    action: {
      minHeight: 40,
      paddingHorizontal: SPACE.x4,
      borderRadius: RADIUS.control,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      justifyContent: 'center',
    },
    actionText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  });
}
