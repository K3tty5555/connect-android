import { StyleSheet, Text, View } from 'react-native';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerDownLeft,
} from 'lucide-react-native';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from './MotionPressable';
import { t } from '../i18n';

interface QuickKey {
  accessibilityLabel: string;
  data: string;
  label?: string;
  Icon?: typeof ArrowLeft;
}

const QUICK_KEYS: readonly QuickKey[] = [
  { accessibilityLabel: '发送 Escape 键', data: '\x1b', label: 'esc' },
  { accessibilityLabel: '发送向左方向键', data: '\x1b[D', Icon: ArrowLeft },
  { accessibilityLabel: '发送向下方向键', data: '\x1b[B', Icon: ArrowDown },
  { accessibilityLabel: '发送向上方向键', data: '\x1b[A', Icon: ArrowUp },
  { accessibilityLabel: '发送向右方向键', data: '\x1b[C', Icon: ArrowRight },
  { accessibilityLabel: '发送回车键', data: '\r', Icon: CornerDownLeft },
];

export function TerminalQuickKeys({
  theme,
  onInput,
}: {
  theme: ConnectTheme;
  onInput(data: string): void;
}): React.ReactElement {
  const styles = createStyles(theme);

  return (
    <View accessibilityLabel={t('终端快捷键')} style={styles.container}>
      {QUICK_KEYS.map(({ accessibilityLabel, data, label, Icon }) => (
        <MotionPressable
          accessibilityLabel={t(accessibilityLabel)}
          accessibilityRole="button"
          key={accessibilityLabel}
          onPress={() => onInput(data)}
          style={styles.key}
        >
          {Icon
            ? <Icon color={theme.colors.text2} size={18} />
            : <Text style={styles.keyLabel}>{label}</Text>}
        </MotionPressable>
      ))}
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      minHeight: 52,
      paddingHorizontal: SPACE.x2,
      paddingVertical: SPACE.x1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.panel2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x1,
    },
    key: {
      minWidth: 44,
      height: 44,
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyLabel: {
      color: theme.colors.text2,
      fontSize: 12,
      fontWeight: '600',
    },
  });
}
