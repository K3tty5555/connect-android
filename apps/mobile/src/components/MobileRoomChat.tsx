import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { MobileRoomMessage } from '../net/bridgeClient';
import type { ConnectTheme } from '../theme/theme';
import { currentLanguage, t } from '../i18n';
import { STORE_SHOT } from '../storeShot';

// Metro resolves bundled HTML to an asset id. The local host uses Lobe UI's
// ChatList so mobile dialogue surfaces follow the same component contract.
const ROOM_SOURCE = require('../../assets/room/index.html') as unknown as ComponentProps<typeof WebView>['source'];

export interface MobileRoomChatProps {
  messages: readonly MobileRoomMessage[];
  omittedMessages: number;
  userAvatar?: string | null;
  theme: ConnectTheme;
  onImagePress?(messageId: string, imageIndex: number): void;
}

/** Automatic reloads after the content process dies, before the failure stands. */
const MAX_CONTENT_RELOADS = 2;
/** No `ready` by then is shown as a failure; a late `ready` still recovers. */
const LOAD_DEADLINE_MS = 8_000;

type HostMessage = { kind: 'ready' } | { kind: 'imagePress'; messageId: string; imageIndex: number };

function parseHostMessage(raw: string): HostMessage | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && record.kind === 'ready') return { kind: 'ready' };
    if (
      Object.keys(record).length === 3
      && record.kind === 'imagePress'
      && typeof record.messageId === 'string'
      && record.messageId.length >= 1
      && record.messageId.length <= 64
      && Number.isInteger(record.imageIndex)
      && (record.imageIndex as number) >= 0
      && (record.imageIndex as number) <= 3
    ) return record as HostMessage;
    return null;
  } catch {
    return null;
  }
}

export function MobileRoomChat({
  messages,
  omittedMessages,
  userAvatar = null,
  theme,
  onImagePress,
}: MobileRoomChatProps): React.ReactElement {
  const webview = useRef<WebView>(null);
  const ready = useRef(false);
  const latestConfig = useRef('');
  /**
   * `slow`: past the deadline without `ready`. Shown as a failure, but the page
   * stays mounted, so a host that was only slow (a cold WebKit on a busy
   * machine) still comes up. `broken`: the page itself could not load.
   */
  const [loadFailed, setLoadFailed] = useState<'slow' | 'broken' | null>(null);
  const [hostReady, setHostReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const reloads = useRef(0);
  const language = currentLanguage();

  latestConfig.current = JSON.stringify({
    kind: 'config',
    colorScheme: theme.mode,
    messages,
    omittedMessages,
    userAvatar,
    language,
    ...(STORE_SHOT !== null ? { neutralAvatars: true } : {}),
  });

  const postConfig = useCallback((): void => {
    webview.current?.postMessage(latestConfig.current);
  }, []);

  useEffect(() => {
    if (ready.current) postConfig();
  }, [language, messages, omittedMessages, postConfig, theme.mode, userAvatar]);

  useEffect(() => {
    if (hostReady || loadFailed !== null) return;
    const timer = setTimeout(() => setLoadFailed('slow'), LOAD_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [hostReady, loadAttempt, loadFailed]);

  const fail = (): void => {
    ready.current = false;
    setLoadFailed('broken');
  };

  // iOS reclaims WebContent processes (memory pressure, long in background);
  // the page is local, so load it again rather than leave the room dead.
  const contentProcessGone = (): void => {
    ready.current = false;
    setHostReady(false);
    if (reloads.current >= MAX_CONTENT_RELOADS) {
      setLoadFailed('broken');
      return;
    }
    reloads.current += 1;
    setLoadFailed(null);
    setLoadAttempt((attempt) => attempt + 1);
    webview.current?.reload();
  };

  const receive = (event: WebViewMessageEvent): void => {
    const message = parseHostMessage(event.nativeEvent.data);
    if (message?.kind === 'ready') {
      ready.current = true;
      reloads.current = 0;
      setHostReady(true);
      setLoadFailed(null);
      postConfig();
      return;
    }
    if (message?.kind !== 'imagePress') return;
    const source = messages.find((candidate) => candidate.id === message.messageId);
    if (source === undefined || message.imageIndex >= (source.imageCount ?? 0)) return;
    onImagePress?.(message.messageId, message.imageIndex);
  };

  if (loadFailed === 'broken') {
    return (
      <View accessibilityRole="alert" style={[styles.error, { backgroundColor: theme.colors.bg }]}>
        <Text style={{ color: theme.colors.danger }}>{t('协作消息加载失败')}</Text>
      </View>
    );
  }

  const latest = messages.at(-1);
  const accessibilityLabel = latest
    ? t('协作消息，共 {count} 条，最新：{text}', { count: messages.length, text: latest.text })
    : t('协作消息，暂无消息');

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <WebView
      accessibilityLabel={accessibilityLabel}
      allowFileAccess
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      automaticallyAdjustContentInsets={false}
      bounces={false}
      cacheEnabled={false}
      containerStyle={{ backgroundColor: theme.colors.bg }}
      contentInsetAdjustmentBehavior="never"
      domStorageEnabled={false}
      javaScriptCanOpenWindowsAutomatically={false}
      mixedContentMode="never"
      onContentProcessDidTerminate={contentProcessGone}
      onError={fail}
      onMessage={receive}
      onShouldStartLoadWithRequest={(request) => (
        request.url === 'about:blank' || request.url.startsWith('file:')
      )}
      originWhitelist={['file://*']}
      overScrollMode="never"
      ref={webview}
      scrollEnabled
      setSupportMultipleWindows={false}
      source={ROOM_SOURCE}
      style={[styles.webview, { backgroundColor: theme.colors.bg }]}
      testID="mobile-room-chat"
        textInteractionEnabled
      />
      {loadFailed === 'slow' ? (
        <View accessibilityRole="alert" pointerEvents="none" style={[styles.loading, { backgroundColor: theme.colors.bg }]}>
          <Text style={{ color: theme.colors.danger }}>{t('协作消息加载失败')}</Text>
        </View>
      ) : !hostReady ? (
        <View pointerEvents="none" style={[styles.loading, { backgroundColor: theme.colors.bg }]}>
          <Text style={{ color: theme.colors.text3 }}>{t('正在加载协作消息')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  webview: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
