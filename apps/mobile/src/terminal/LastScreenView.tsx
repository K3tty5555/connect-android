import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TerminalFontPreference, TerminalViewPreference } from '../../../../src/shared/types';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';
import type { LastScreen } from './lastScreenStore';
import { NativeTerminalGridView } from './NativeTerminalGridView';
import { SwiftTermGridView } from './SwiftTermGridView';
import { swiftTermAvailable } from './SwiftTermTerminalView';
import { TerminalSwapView } from './TerminalSwapView';
import type { TerminalWebViewHandle } from './TerminalWebView';

const ignoreResize = (): void => {};

/**
 * The saved last screen, read-only and labelled as such.
 *
 * It reports no geometry and no paints: it must never be mistaken for the live
 * terminal by the handover or the swap coordinator. The label stays until the
 * caller removes the whole view on the first live paint.
 */
export function LastScreenView({
  screen,
  terminalView,
  fontFamily,
  theme,
}: {
  screen: LastScreen;
  terminalView: TerminalViewPreference;
  fontFamily: TerminalFontPreference;
  theme: ConnectTheme;
}): React.ReactElement {
  const terminalRef = useRef<TerminalWebViewHandle>(null);
  const content = screen.screen;
  const agent = screen.surfaceKind === 'claude' || screen.surfaceKind === 'codex' || screen.surfaceKind === 'shell'
    ? screen.surfaceKind
    : undefined;

  useEffect(() => {
    if (content.kind !== 'bytes') return;
    terminalRef.current?.replace(content.segments);
  }, [content]);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.panel }]} testID="terminal-last-screen">
      {content.kind === 'grid' && terminalView === 'swiftterm-view' && swiftTermAvailable ? (
        <SwiftTermGridView
          agent={agent}
          fontFamily={fontFamily}
          frame={content.frame}
          theme={theme}
        />
      ) : content.kind === 'grid' ? (
        <NativeTerminalGridView
          agent={agent}
          fontFamily={fontFamily}
          frame={content.frame}
          presentation={terminalView === 'exact-grid-view' ? 'exact-grid-view' : 'reflow-view'}
          theme={theme}
        />
      ) : (
        <TerminalSwapView
          agent={agent ?? 'shell'}
          fontFamily={fontFamily}
          onResize={ignoreResize}
          panelId="last-screen"
          ref={terminalRef}
          renderer={terminalView === 'swiftterm-view' ? 'swiftterm' : 'webview'}
          theme={theme}
        />
      )}
      <View
        pointerEvents="none"
        style={[styles.badge, { backgroundColor: theme.colors.panel2, borderColor: theme.colors.line2 }]}
      >
        <Text style={[styles.badgeText, { color: theme.colors.text2 }]}>{t('上次画面')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  badge: {
    position: 'absolute',
    top: SPACE.x2,
    right: SPACE.x2,
    paddingHorizontal: SPACE.x2,
    paddingVertical: 2,
    borderRadius: RADIUS.control,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: { fontSize: 12, fontWeight: '600' },
});
