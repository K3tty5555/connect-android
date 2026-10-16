import { StyleSheet } from 'react-native';
import { ArrowDown } from 'lucide-react-native';
import { MotionPressable } from '../components/MotionPressable';
import { t } from '../i18n';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';

/**
 * The way back to the newest row once the reader is up in SwiftTerm's
 * scrollback: the same corner, size and icon as the other terminal views.
 */
export function SwiftTermLatestButton({ onPress, theme }: {
  onPress(): void;
  theme: ConnectTheme;
}): React.ReactElement {
  return (
    <MotionPressable
      accessibilityLabel={t('回到最新')}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.latestButton, { backgroundColor: theme.colors.panel2, borderColor: theme.colors.line2 }]}
      testID="swiftterm-latest"
    >
      <ArrowDown color={theme.colors.text} size={18} />
    </MotionPressable>
  );
}

const styles = StyleSheet.create({
  latestButton: {
    position: 'absolute',
    right: SPACE.x3,
    bottom: SPACE.x3,
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
