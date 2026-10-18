import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ScanLine, ShieldCheck, X } from 'lucide-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { PairedDesktopProfile } from '../net/bridgeClient';
import { parsePairingQr, type PairingRelayConfig } from './pairingClient';
import { PendingRelayStore } from '../net/pendingRelay';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';

export interface PairingController {
  start(rawQr: string, deviceName: string, relayConfig?: PairingRelayConfig): Promise<string>;
  confirmSas(): Promise<PairedDesktopProfile>;
  rejectSas(): void;
  cancel(): void;
}

type FlowState = 'scanner' | 'relay_setup' | 'connecting' | 'sas' | 'waiting' | 'error';

export function PairingFlow({
  open,
  theme,
  client,
  onPaired,
  onClose,
  initialSas,
}: {
  open: boolean;
  /** App Store screenshot scene only: opens on the digit check the scan leads to. */
  initialSas?: string;
  theme: ConnectTheme;
  client: PairingController;
  onPaired(profile: PairedDesktopProfile): void;
  onClose(): void;
}): React.ReactElement {
  const [permission, requestPermission] = useCameraPermissions();
  const [state, setState] = useState<FlowState>('scanner');
  const [sas, setSas] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relayConfig, setRelayConfig] = useState<PairingRelayConfig | null>(null);
  const [relayUrl, setRelayUrl] = useState('');
  const [relayApiKey, setRelayApiKey] = useState('');
  const [relayFallbackUrl, setRelayFallbackUrl] = useState('');
  const [relayFallbackApiKey, setRelayFallbackApiKey] = useState('');
  const [pendingRelayQr, setPendingRelayQr] = useState<string | null>(null);
  const pendingRelayStore = useRef(new PendingRelayStore());
  const scanned = useRef(false);
  const styles = createStyles(theme);

  useEffect(() => {
    if (!open) return;
    scanned.current = initialSas !== undefined;
    setState(initialSas !== undefined ? 'sas' : 'scanner');
    setSas(initialSas ?? null);
    setError(null);
    void pendingRelayStore.current.load().then((config) => {
      setRelayConfig(config);
      setRelayUrl(config?.url ?? '');
      setRelayApiKey(config?.apiKey ?? '');
      setRelayFallbackUrl(config?.fallbacks?.[0]?.url ?? '');
      setRelayFallbackApiKey(config?.fallbacks?.[0]?.apiKey ?? '');
    });
  }, [initialSas, open]);

  const close = (): void => {
    client.cancel();
    onClose();
  };

  const scan = async (rawQr: string, relayOverride: PairingRelayConfig | null = relayConfig): Promise<void> => {
    if (scanned.current) return;
    scanned.current = true;
    setState('connecting');
    setError(null);
    try {
      let parsed: ReturnType<typeof parsePairingQr> | null = null;
      try { parsed = parsePairingQr(rawQr); } catch { /* controller remains the source of pairing validation */ }
      if (parsed?.relay !== undefined && relayOverride === null) {
        scanned.current = false;
        setPendingRelayQr(rawQr);
        setState('relay_setup');
        return;
      }
      const value = await client.start(rawQr, Platform.OS === 'ios' ? 'iPhone Connect' : 'Android Connect', relayOverride ?? undefined);
      setSas(value);
      setState('sas');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('无法完成配对。'));
      setState('error');
    }
  };

  const saveRelayAndContinue = async (): Promise<void> => {
    const url = relayUrl.trim();
    const apiKey = relayApiKey.trim();
    if (pendingRelayQr === null || !/^wss:\/\//u.test(url) || !/^ck_live_[A-Za-z0-9_-]{32,140}$/u.test(apiKey)) {
      setError(t('请输入有效的 Relay 地址和 API Key。'));
      return;
    }
    const config = {
      url,
      apiKey,
      ...(relayFallbackUrl.trim() && relayFallbackApiKey.trim()
        ? { fallbacks: [{ url: relayFallbackUrl.trim(), apiKey: relayFallbackApiKey.trim() }] }
        : {}),
    };
    await pendingRelayStore.current.save(config);
    setRelayConfig(config);
    await scan(pendingRelayQr, config);
  };

  const confirm = async (): Promise<void> => {
    if (state !== 'sas') return;
    setState('waiting');
    try {
      const profile = await client.confirmSas();
      onPaired(profile);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('电脑未确认配对。'));
      setState('error');
    }
  };

  const reject = (): void => {
    client.rejectSas();
    onClose();
  };

  const openSystemSettings = async (): Promise<void> => {
    try {
      await Linking.openSettings();
    } catch {
      setError(t('无法打开系统设置。'));
      setState('error');
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={state === 'sas' ? undefined : close}
      presentationStyle="fullScreen"
      visible={open}
    >
      {/* A Modal is its own native view tree: without a provider inside it the
          SafeAreaView finds none and the title slides under the status bar. */}
      <SafeAreaProvider testID="pairing-safe-area-provider">
      <SafeAreaView
        edges={['top', 'bottom', 'left', 'right']}
        style={styles.root}
        testID="pairing-safe-area"
      >
        {/* SAS has no way out but the two equal-weight answers, so it gets no
            header bar: its title sits with the digits as one centred group. */}
        {state === 'sas' || state === 'waiting' ? null : (
          <View style={styles.header}>
            <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.title}>{t('配对电脑')}</Text>
            <Pressable
              accessibilityLabel={t('关闭配对')}
              accessibilityRole="button"
              hitSlop={SPACE.x2}
              onPress={close}
              style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
            >
              <X color={theme.colors.text2} size={23} />
            </Pressable>
          </View>
        )}

        {state === 'scanner' ? (
          permission?.granted ? (
            <View style={styles.cameraFrame}>
              <CameraView
                active={open}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => { void scan(data); }}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="none" style={styles.scanGuide}>
                <ScanLine color={theme.colors.text} size={38} />
              </View>
            </View>
          ) : (
            <View style={styles.center}>
              <ScanLine color={theme.colors.text2} size={32} />
              <Text style={styles.muted}>{t('扫描电脑上的配对二维码')}</Text>
              {permission?.canAskAgain === false ? (
                <>
                  <Text style={styles.error}>{t('请在系统设置中允许相机访问。')}</Text>
                  <Pressable
                    accessibilityLabel={t('打开系统设置')}
                    accessibilityRole="button"
                    onPress={() => { void openSystemSettings(); }}
                    style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
                  >
                    <Text style={styles.actionText}>{t('打开系统设置')}</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  accessibilityLabel={t('允许相机')}
                  accessibilityRole="button"
                  onPress={() => { void requestPermission(); }}
                  style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
                >
                  <Text style={styles.actionText}>{t('允许相机')}</Text>
                </Pressable>
              )}
            </View>
          )
        ) : null}

        {state === 'relay_setup' ? (
          <View style={styles.center}>
            <Text style={styles.muted}>{t('通过私人 Relay 配对')}</Text>
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setRelayUrl} placeholder="wss://relay.example.com/v1/relay" value={relayUrl} style={styles.relayInput} />
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setRelayApiKey} placeholder="ck_live_…" secureTextEntry value={relayApiKey} style={styles.relayInput} />
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setRelayFallbackUrl} placeholder={t('备用 Relay 地址（可选）')} value={relayFallbackUrl} style={styles.relayInput} />
            <TextInput autoCapitalize="none" autoCorrect={false} onChangeText={setRelayFallbackApiKey} placeholder={t('备用 Relay API Key（可选）')} secureTextEntry value={relayFallbackApiKey} style={styles.relayInput} />
            <Pressable accessibilityRole="button" onPress={() => { void saveRelayAndContinue(); }} style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
              <Text style={styles.actionText}>{t('保存并继续')}</Text>
            </Pressable>
          </View>
        ) : null}

        {state === 'connecting' ? (
          <View style={styles.center}><Text style={styles.muted}>{t('正在验证配对码…')}</Text></View>
        ) : null}

        {state === 'sas' || state === 'waiting' ? (
          <View style={styles.sasContent} testID="pairing-sas">
            <ShieldCheck color={theme.colors.warn} size={30} />
            <View style={styles.sasHeading}>
              <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.sasTitle}>{t('核对两端数字')}</Text>
              <Text style={styles.muted}>{t('确认电脑上显示的数字完全一致')}</Text>
            </View>
            <View accessibilityLabel={t('核对数字 {sas}', { sas: sas ?? '' })} style={styles.digits}>
              {(sas ?? '').split('').map((digit, index) => (
                <View key={`${index}-${digit}`} style={styles.digitBox}>
                  <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.digit}>{digit}</Text>
                </View>
              ))}
            </View>
            <View style={styles.sasActions}>
              <Pressable
                accessibilityLabel={t('不一致，取消')}
                accessibilityRole="button"
                disabled={state === 'waiting'}
                onPress={reject}
                style={({ pressed }) => [styles.sasAction, pressed ? styles.pressed : null]}
              >
                <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.sasActionText}>{t('不一致，取消')}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t('一致，确认配对')}
                accessibilityRole="button"
                disabled={state === 'waiting'}
                onPress={() => { void confirm(); }}
                style={({ pressed }) => [styles.sasAction, pressed ? styles.pressed : null]}
              >
                <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.sasActionText}>{state === 'waiting' ? t('等待电脑确认') : t('一致，确认配对')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {state === 'error' ? (
          <View style={styles.center}>
            <Text style={styles.error}>{error ? t(error) : null}</Text>
            <Pressable
              accessibilityLabel={t('重新扫描')}
              accessibilityRole="button"
              onPress={() => {
                scanned.current = false;
                setError(null);
                setState('scanner');
              }}
              style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
            >
              <Text style={styles.actionText}>{t('重新扫描')}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={t('打开系统设置')}
              accessibilityRole="button"
              onPress={() => { void openSystemSettings(); }}
              style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
            >
              <Text style={styles.actionText}>{t('打开系统设置')}</Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    header: {
      minHeight: 64,
      paddingTop: SPACE.x2,
      paddingHorizontal: SPACE.x4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.control },
    cameraFrame: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    scanGuide: {
      width: 240,
      height: 240,
      borderWidth: 2,
      borderColor: theme.colors.text,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    center: { flex: 1, padding: SPACE.x6, alignItems: 'center', justifyContent: 'center', gap: SPACE.x4 },
    muted: { color: theme.colors.text2, fontSize: 15, textAlign: 'center' },
    error: { color: theme.colors.danger, fontSize: 15, textAlign: 'center' },
    action: {
      minWidth: 128,
      minHeight: 46,
      paddingHorizontal: SPACE.x4,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionText: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
    relayInput: {
      width: '90%',
      minHeight: 46,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: RADIUS.control,
      color: theme.colors.text,
      paddingHorizontal: SPACE.x3,
    },
    pressed: { backgroundColor: theme.colors.panel2 },
    sasContent: { flex: 1, padding: SPACE.x6, alignItems: 'center', justifyContent: 'center', gap: SPACE.x5 },
    sasHeading: { alignItems: 'center', gap: SPACE.x2 },
    sasTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
    digits: { flexDirection: 'row', gap: SPACE.x2 },
    // Grows with the digit: at the compact cap a fixed box cut digits in half.
    digitBox: {
      minWidth: 42,
      minHeight: 54,
      paddingHorizontal: SPACE.x1,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      alignItems: 'center',
      justifyContent: 'center',
    },
    digit: { color: theme.colors.text, fontSize: 28, fontWeight: '700' },
    sasActions: { width: '100%', maxWidth: 460, flexDirection: 'row', gap: SPACE.x3 },
    sasAction: {
      minWidth: 0,
      minHeight: 52,
      flex: 1,
      paddingHorizontal: SPACE.x2,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sasActionText: { color: theme.colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  });
}
