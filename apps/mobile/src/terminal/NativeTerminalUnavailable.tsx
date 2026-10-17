import { StyleSheet, Text, View } from 'react-native';
import type { ConnectTheme } from '../theme/theme';
import { SPACE } from '../theme/tokens';
import { t } from '../i18n';

/**
 * Shown where the native terminal (SwiftTerm / Termux) is missing from this
 * binary. There is no other renderer to fall back to (MOBILE-NATIVE-RENDERER-ONLY-01),
 * so the honest answer is to say so rather than draw something else.
 */
export function NativeTerminalUnavailable({ theme }: { theme: ConnectTheme }): React.ReactElement {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.container, { backgroundColor: theme.colors.panel }]}
      testID="terminal-native-unavailable"
    >
      <Text style={{ color: theme.colors.text2, textAlign: 'center' }}>
        {t('此版本缺少原生终端，请更新 Connect')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.x4 },
});
