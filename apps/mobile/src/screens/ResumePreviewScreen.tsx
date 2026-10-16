import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import type { TerminalFontPreference, TerminalViewPreference } from '../../../../src/shared/types';
import { MotionPressable } from '../components/MotionPressable';
import type { ConnectionState } from '../domain/session';
import type { ConnectTheme } from '../theme/theme';
import { SPACE } from '../theme/tokens';
import { t } from '../i18n';
import { panelDisplayLabel } from '../domain/panelLabel';
import type { LastScreen } from '../terminal/lastScreenStore';
import { LastScreenView } from '../terminal/LastScreenView';

/**
 * What a cold start shows while it reconnects to the terminal it left.
 *
 * The live session route needs the desktop's catalog, which is round trips
 * away; until then this is the terminal as it was last seen, read-only and
 * labelled. Going back gives up the resume and lands on 首页.
 */
export function ResumePreviewScreen({
  screen,
  connection,
  connectionDetail,
  terminalView,
  fontFamily,
  theme,
  onBack,
}: {
  screen: LastScreen;
  connection: ConnectionState;
  connectionDetail: string | null;
  terminalView: TerminalViewPreference;
  fontFamily: TerminalFontPreference;
  theme: ConnectTheme;
  onBack(): void;
}): React.ReactElement {
  const status = connection === 'online'
    ? t('正在打开…')
    : connection === 'offline' && connectionDetail !== null
      ? t(connectionDetail)
      : t('正在连接…');
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={[styles.header, { borderBottomColor: theme.colors.line }]}>
        <MotionPressable
          accessibilityLabel={t('返回首页')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={styles.back}
        >
          <ChevronLeft color={theme.colors.text} size={22} />
        </MotionPressable>
        <View style={styles.titles}>
          <Text numberOfLines={1} style={[styles.title, { color: theme.colors.text }]}>
            {panelDisplayLabel({
              kind: screen.surfaceKind,
              label: screen.surfaceLabel,
              workspaceLabel: screen.workspaceLabel,
            })}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            numberOfLines={1}
            style={[styles.status, { color: theme.colors.text3 }]}
          >
            {status}
          </Text>
        </View>
      </View>
      <LastScreenView
        fontFamily={fontFamily}
        screen={screen}
        terminalView={terminalView}
        theme={theme}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 52,
    paddingHorizontal: SPACE.x2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.x1,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '600' },
  status: { fontSize: 12 },
});
