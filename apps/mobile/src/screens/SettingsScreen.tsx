import { useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  ExternalLink,
  Info,
  Keyboard as KeyboardIcon,
  Languages,
  Laptop,
  Palette,
  Scale,
  SquareTerminal,
  Unlink,
  UserRound,
} from 'lucide-react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  MobilePreferences,
  LanguagePreference,
  MobileThemePreference,
  PublicAppInfo,
  PublicLinkKind,
  TerminalShortcutKey,
} from '../../../../src/shared/types';
import { LANGUAGE_AUTONYMS } from '../../../../src/shared/languageAutonyms';
import {
  collaborationProfileWorkspace,
  type ConnectionState,
  type SessionViewModel,
} from '../domain/session';
import type { MobilePreferencesPatch } from '../settings/preferencesStore';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from '../components/MotionPressable';
import { SettingsSelect } from '../components/SettingsSelect';
import { t } from '../i18n';
import { swiftTermAvailable } from '../terminal/SwiftTermTerminalView';
import { useAndroidBack } from '../platform/useAndroidBack';

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  unpaired: '尚未绑定',
  online: '在线',
  confirming: '正在确认',
  reconnecting: '正在重连',
  offline: '离线',
};

const THEME_OPTIONS: ReadonlyArray<{
  value: MobileThemePreference;
  label: string;
}> = [
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
];

const LANGUAGE_OPTIONS: ReadonlyArray<{
  value: LanguagePreference;
  label: string;
}> = [
  { value: 'system', label: '跟随系统' },
  { value: 'zh-Hans', label: LANGUAGE_AUTONYMS['zh-Hans'] },
  { value: 'zh-Hant', label: LANGUAGE_AUTONYMS['zh-Hant'] },
  { value: 'en', label: LANGUAGE_AUTONYMS.en },
];

const TERMINAL_VIEW_OPTIONS: ReadonlyArray<{
  value: MobilePreferences['terminalView'];
  label: string;
  description: string;
}> = [
  { value: 'reflow-view', label: 'Reflow View', description: '按手机宽度重新折行，适合阅读' },
  { value: 'exact-grid-view', label: 'Exact Grid View', description: '与电脑终端逐格一致，可横向拖动' },
  { value: 'webview', label: 'WebView', description: '兼容模式，其他视图异常时使用' },
  // Offered only where the binary carries the native view; elsewhere choosing it
  // would silently mean the WebView. The label is resolved per platform at render.
  ...(swiftTermAvailable
    ? [{ value: 'swiftterm-view' as const, label: 'SwiftTerm', description: '原生终端引擎，全屏程序的历史也可本地翻看' }]
    : []),
];

/**
 * 原生终端按实际引擎命名：iOS 是 SwiftTerm，Android 是 Termux（2026-10-15）。
 * 存储值 `swiftterm-view` 两端共用不改名，已选过的用户升级后选择照旧生效。
 */
/**
 * Android 版内嵌 Termux（GPLv3），整个 Android 版随之以 GPLv3 开源（用户 2026-10-15/16 拍板）。
 * 这段是 GPLv3 §0 要求的适当法律声明：协议、无担保、源码去处，以及随包第三方组件的许可。
 */
const ANDROID_OPEN_SOURCE_NOTICE = 'Connect Android 版是自由软件，按 GNU GPL 第 3 版发布，不提供任何担保。\n源码：github.com/K3tty5555/connect-android\n© 2026 武凯迪 (Ketty Wu)\n\n内含：Termux 终端组件（GPLv3）、DejaVu Sans Mono（Bitstream Vera 许可）、JetBrains Mono 与 Noto Sans Symbols（SIL OFL 1.1）。';

/**
 * 默认终端字体（存储值 `menlo`）按实际字体命名：iOS 是系统的 Menlo；Android 没有 Menlo 且不能随包分发，
 * 用随包的 DejaVu Sans Mono——Menlo 即由它派生，字形几乎一致（2026-10-15）。
 */
function defaultTerminalFontLabel(): { label: string; description: string } {
  return Platform.OS === 'android'
    ? { label: 'DejaVu Sans Mono', description: '与 iOS 默认的 Menlo 同源的等宽字体' }
    : { label: 'Menlo', description: '系统自带的等宽字体' };
}

function nativeTerminalLabel(): string {
  return Platform.OS === 'android' ? 'Termux' : 'SwiftTerm';
}

const TERMINAL_FONT_OPTIONS: ReadonlyArray<{
  value: NonNullable<MobilePreferences['terminalFont']>;
  label: string;
  description: string;
}> = [
  { value: 'menlo', label: 'Menlo', description: '系统自带的等宽字体' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', description: '开源编程字体，笔画更清晰' },
];

const TAKEOVER_GEOMETRY_OPTIONS: ReadonlyArray<{
  value: boolean;
  label: string;
  description: string;
}> = [
  { value: true, label: '跟随手机', description: '终端按手机屏幕重新排版' },
  { value: false, label: '保持电脑尺寸', description: '终端保持电脑的排版，手机按电脑宽度显示' },
];

const AUTO_TAKEOVER_OPTIONS: ReadonlyArray<{
  value: boolean;
  label: string;
  description: string;
}> = [
  { value: true, label: '自动接管', description: '打开终端就能直接输入，电脑端暂时遮住' },
  { value: false, label: '只查看', description: '打开终端只看不写，需要时再点接管' },
];

const TERMINAL_SHORTCUT_ACTIONS: ReadonlyArray<{
  key: 'interrupt' | 'eof' | 'cancel';
  label: string;
  description: string;
}> = [
  { key: 'interrupt', label: '中断', description: '停止正在运行的命令' },
  { key: 'eof', label: '结束输入', description: '告诉程序输入已结束' },
  { key: 'cancel', label: '挂起', description: '把当前程序暂停到后台' },
];
const TERMINAL_SHORTCUT_KEYS: readonly TerminalShortcutKey[] = ['c', 'd', 'z'];

export function SettingsScreen({
  state,
  presentedConnection = state.connection,
  theme,
  preferences,
  preferencesReady,
  preferencesPending,
  preferencesError,
  collaborationAvatar = null,
  avatarPending = false,
  avatarError = null,
  unpairPending,
  unpairError,
  onPreferencesChange,
  onAvatarPick,
  onUnpair,
  publicAppInfo,
  onOpenPublicLink,
  onBack,
}: {
  state: SessionViewModel;
  presentedConnection?: ConnectionState;
  theme: ConnectTheme;
  preferences: MobilePreferences;
  preferencesReady: boolean;
  preferencesPending: boolean;
  preferencesError: string | null;
  collaborationAvatar?: string | null;
  avatarPending?: boolean;
  avatarError?: string | null;
  unpairPending: boolean;
  unpairError: string | null;
  onPreferencesChange(patch: MobilePreferencesPatch): void;
  onAvatarPick?(): void;
  onUnpair(): void;
  publicAppInfo?: PublicAppInfo;
  onOpenPublicLink?(kind: PublicLinkKind): Promise<void>;
  /** 设置从首页右上角进入，是一层页面而不是 tab：返回回到首页（安卓硬件返回同此）。 */
  onBack?(): void;
}): React.ReactElement {
  const styles = createStyles(theme);
  const insets = useSafeAreaInsets();
  useAndroidBack('', onBack ? () => {
    onBack();
    return true;
  } : undefined);
  const connected = state.connection === 'online';
  const preferenceDisabled = !preferencesReady || preferencesPending;
  // Everyday settings stay in view; the rest waits behind one tap.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const avatarDisabled = !connected
    || !state.canControlInput
    || collaborationProfileWorkspace(state.workspaces) === undefined
    || avatarPending
    || onAvatarPick === undefined;
  const scope = connected
    ? state.canControlInput ? t('读取与写入') : t('仅可读取')
    : t('连接后确认');
  const [publicLinkPending, setPublicLinkPending] = useState<PublicLinkKind | null>(null);
  const [publicLinkError, setPublicLinkError] = useState<string | null>(null);

  const openPublicLink = async (kind: PublicLinkKind): Promise<void> => {
    if (
      publicAppInfo?.links[kind] === null
      || publicAppInfo?.links[kind] === undefined
      || !onOpenPublicLink
      || publicLinkPending !== null
    ) return;
    setPublicLinkPending(kind);
    setPublicLinkError(null);
    try {
      await onOpenPublicLink(kind);
    } catch {
      setPublicLinkError(t('无法打开链接，请重试。'));
    } finally {
      setPublicLinkPending(null);
    }
  };

  const confirmUnpair = (): void => {
    Alert.alert(
      t('解除电脑绑定？'),
      t('本机会删除当前电脑的配对资料，下次连接需要重新扫码。'),
      [
        { text: t('取消'), style: 'cancel' },
        { text: t('解除绑定'), style: 'destructive', onPress: onUnpair },
      ],
    );
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      <View style={styles.header} testID="settings-header">
        {onBack ? (
          <MotionPressable
            accessibilityLabel={t('返回首页')}
            accessibilityRole="button"
            onPress={onBack}
            style={styles.backButton}
          >
            <ChevronLeft color={theme.colors.text2} size={21} />
          </MotionPressable>
        ) : null}
        <Text style={styles.title}>{t('设置')}</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: SPACE.x6 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection icon={Laptop} title={t('当前电脑')} theme={theme}>
          <FactRow label={t('设备')} value={state.deviceName} theme={theme} />
          <FactRow
            label={t('连接')}
            value={t(CONNECTION_LABELS[presentedConnection])}
            valueTone={presentedConnection === 'online' ? 'ok' : 'secondary'}
            theme={theme}
          />
          <FactRow label={t('权限')} value={scope} theme={theme} />
        </SettingsSection>

        <SettingsSection icon={UserRound} title={t('协作身份')} theme={theme}>
          <MotionPressable
            accessibilityLabel={avatarPending ? t('正在更新协作头像') : t('更换协作头像')}
            accessibilityRole="button"
            accessibilityState={{ busy: avatarPending, disabled: avatarDisabled }}
            disabled={avatarDisabled}
            onPress={onAvatarPick}
            style={[styles.avatarRow, avatarDisabled ? styles.disabled : null]}
          >
            <Text style={styles.rowLabel}>{t('头像')}</Text>
            <View style={styles.avatarValue}>
              {collaborationAvatar ? (
                <Image source={{ uri: collaborationAvatar }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{t('我')}</Text>
                </View>
              )}
              <ChevronRight color={theme.colors.text3} size={18} />
            </View>
          </MotionPressable>
          {avatarError ? (
            <Text accessibilityRole="alert" style={styles.inlineError}>{t(avatarError)}</Text>
          ) : null}
        </SettingsSection>

        <SettingsSection icon={Palette} title={t('外观')} theme={theme}>
          <View accessibilityRole="radiogroup" style={styles.segmentedControl}>
            {THEME_OPTIONS.map((option) => {
              const selected = option.value === preferences.theme;
              return (
                <MotionPressable
                  accessibilityLabel={t(option.label)}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selected,
                    disabled: preferenceDisabled,
                  }}
                  disabled={preferenceDisabled}
                  key={option.value}
                  onPress={() => onPreferencesChange({ theme: option.value })}
                  style={[
                    styles.segment,
                    selected ? styles.segmentSelected : null,
                    preferenceDisabled ? styles.disabled : null,
                  ]}
                >
                  <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={[
                    styles.segmentLabel,
                    selected ? styles.segmentLabelSelected : null,
                  ]}>
                    {t(option.label)}
                  </Text>
                  {selected ? <Check color={theme.colors.accent} size={15} /> : null}
                </MotionPressable>
              );
            })}
          </View>
        </SettingsSection>

        <SettingsSection icon={Languages} title={t('语言')} theme={theme}>
          <View accessibilityRole="radiogroup" style={styles.segmentedControl}>
            {LANGUAGE_OPTIONS.map((option) => {
              const selected = option.value === (preferences.language ?? 'system');
              const label = option.value === 'system' ? t(option.label) : option.label;
              return (
                <MotionPressable
                  accessibilityLabel={label}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: preferenceDisabled }}
                  disabled={preferenceDisabled}
                  key={option.value}
                  onPress={() => onPreferencesChange({ language: option.value })}
                  style={[
                    styles.segment,
                    selected ? styles.segmentSelected : null,
                    preferenceDisabled ? styles.disabled : null,
                  ]}
                >
                  <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={[
                    styles.segmentLabel,
                    selected ? styles.segmentLabelSelected : null,
                  ]}>
                    {label}
                  </Text>
                  {selected ? <Check color={theme.colors.accent} size={15} /> : null}
                </MotionPressable>
              );
            })}
          </View>
        </SettingsSection>

        <MotionPressable
          accessibilityLabel={t('进阶设置')}
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          onPress={() => setAdvancedOpen((open) => !open)}
          style={styles.groupToggle}
        >
          <Text accessibilityRole="header" style={styles.groupTitle}>{t('进阶设置')}</Text>
          {advancedOpen
            ? <ChevronUp color={theme.colors.text3} size={16} />
            : <ChevronDown color={theme.colors.text3} size={16} />}
        </MotionPressable>
        {advancedOpen ? (
          <>
            <SettingsSection icon={SquareTerminal} title={t('终端显示')} theme={theme}>
              <SettingsSelect
                description={t('手机上怎样画出终端')}
                disabled={preferenceDisabled}
                onChange={(terminalView) => onPreferencesChange({ terminalView })}
                options={TERMINAL_VIEW_OPTIONS.map((option) => ({
                  ...option,
                  label: option.value === 'swiftterm-view' ? nativeTerminalLabel() : option.label,
                  description: t(option.description),
                }))}
                theme={theme}
                title={t('终端视图')}
                // A stored SwiftTerm this build cannot draw shows as what is really used.
                value={preferences.terminalView === 'swiftterm-view' && !swiftTermAvailable
                  ? 'reflow-view'
                  : preferences.terminalView}
              />
              <SettingsSelect
                description={t('终端里文字的字体')}
                disabled={preferenceDisabled}
                onChange={(terminalFont) => onPreferencesChange({ terminalFont })}
                options={TERMINAL_FONT_OPTIONS.map((option) => ({
                  ...option,
                  ...(option.value === 'menlo' ? defaultTerminalFontLabel() : {}),
                  description: t(option.value === 'menlo' ? defaultTerminalFontLabel().description : option.description),
                }))}
                theme={theme}
                title={t('终端字体')}
                value={preferences.terminalFont ?? 'menlo'}
              />
              <SettingsSelect
                description={t('在手机上打开终端时')}
                disabled={preferenceDisabled}
                onChange={(autoTakeover) => onPreferencesChange({ autoTakeover })}
                options={AUTO_TAKEOVER_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.label),
                  description: t(option.description),
                }))}
                theme={theme}
                title={t('打开终端时')}
                value={preferences.autoTakeover !== false}
              />
              <SettingsSelect
                description={t('手机接管输入时，终端按谁的屏幕排版')}
                disabled={preferenceDisabled}
                onChange={(takeoverFollowsPhone) => onPreferencesChange({ takeoverFollowsPhone })}
                options={TAKEOVER_GEOMETRY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.label),
                  description: t(option.description),
                }))}
                theme={theme}
                title={t('接管时终端尺寸')}
                value={preferences.takeoverFollowsPhone !== false}
              />
            </SettingsSection>

            {/* The Simple/Full keyboard switch lives in the composer toolbar: it is a
                per-window input choice, not a setting. Only the bindings the full
                keyboard sends stay configurable here. */}
            <SettingsSection icon={KeyboardIcon} title={t('终端快捷键')} theme={theme}>
              {TERMINAL_SHORTCUT_ACTIONS.map((action) => {
                const selectedKey = preferences.terminalShortcuts?.[action.key] ?? (
                  action.key === 'interrupt' ? 'c' : action.key === 'eof' ? 'd' : 'z'
                );
                return (
                  <SettingsSelect
                    description={t(action.description)}
                    disabled={preferenceDisabled}
                    key={action.key}
                    onChange={(key) => onPreferencesChange({
                      terminalShortcuts: {
                        ...(preferences.terminalShortcuts ?? { interrupt: 'c', eof: 'd', cancel: 'z' }),
                        [action.key]: key,
                      },
                    })}
                    options={TERMINAL_SHORTCUT_KEYS.map((key) => ({
                      value: key,
                      label: `Ctrl+${key.toUpperCase()}`,
                    }))}
                    theme={theme}
                    title={t(action.label)}
                    value={selectedKey}
                  />
                );
              })}
            </SettingsSection>
          </>
        ) : null}

        {preferencesError ? (
          <Text accessibilityRole="alert" style={styles.error}>{t(preferencesError)}</Text>
        ) : null}

        <SettingsSection icon={Info} title={t('关于 Connect')} theme={theme}>
          <FactRow label={t('版本')} value={publicAppInfo?.version ?? '—'} theme={theme} />
          {Platform.OS === 'android' ? (
            <PublicLinkRow
              configured={publicAppInfo?.links.androidDownload !== null && publicAppInfo?.links.androidDownload !== undefined}
              icon={Download}
              kind="androidDownload"
              label={t('获取更新')}
              pending={publicLinkPending !== null}
              theme={theme}
              onPress={() => void openPublicLink('androidDownload')}
            />
          ) : null}
          <PublicLinkRow
            configured={publicAppInfo?.links.macDownload !== null && publicAppInfo?.links.macDownload !== undefined}
            icon={Download}
            kind="macDownload"
            label={t('Mac 下载')}
            pending={publicLinkPending !== null}
            theme={theme}
            onPress={() => void openPublicLink('macDownload')}
          />
          <PublicLinkRow
            configured={publicAppInfo?.links.privacy !== null && publicAppInfo?.links.privacy !== undefined}
            kind="privacy"
            label={t('隐私政策')}
            pending={publicLinkPending !== null}
            theme={theme}
            onPress={() => void openPublicLink('privacy')}
          />
          <PublicLinkRow
            configured={publicAppInfo?.links.support !== null && publicAppInfo?.links.support !== undefined}
            kind="support"
            label={t('支持')}
            pending={publicLinkPending !== null}
            theme={theme}
            onPress={() => void openPublicLink('support')}
          />
          <PublicLinkRow
            configured={publicAppInfo?.links.compatibility !== null && publicAppInfo?.links.compatibility !== undefined}
            kind="compatibility"
            label={t('兼容性')}
            pending={publicLinkPending !== null}
            theme={theme}
            onPress={() => void openPublicLink('compatibility')}
          />
          {Platform.OS === 'android' ? (
            <MotionPressable
              accessibilityLabel={t('开源许可')}
              accessibilityRole="button"
              onPress={() => Alert.alert(t('开源许可'), t(ANDROID_OPEN_SOURCE_NOTICE))}
              style={styles.publicLinkRow}
              testID="open-source-license"
            >
              <View style={styles.publicLinkLabel}>
                <Scale color={theme.colors.text2} size={18} />
                <Text style={styles.rowLabel}>{t('开源许可')}</Text>
              </View>
              <View style={styles.publicLinkValue}>
                <Text style={styles.rowValueSecondary}>GPLv3</Text>
                <ChevronRight color={theme.colors.text3} size={18} />
              </View>
            </MotionPressable>
          ) : null}
          {publicLinkError ? (
            <Text accessibilityRole="alert" style={styles.inlineError}>{publicLinkError}</Text>
          ) : null}
        </SettingsSection>

        <View style={styles.dangerSection}>
          <MotionPressable
            accessibilityLabel={unpairPending ? t('正在解除电脑绑定') : t('解除当前电脑绑定')}
            accessibilityRole="button"
            accessibilityState={{ busy: unpairPending, disabled: unpairPending }}
            disabled={unpairPending}
            onPress={confirmUnpair}
            style={[styles.dangerAction, unpairPending ? styles.disabled : null]}
          >
            <Unlink color={theme.colors.danger} size={19} />
            <Text style={styles.dangerLabel}>
              {unpairPending ? t('正在解除绑定') : t('解除当前电脑绑定')}
            </Text>
          </MotionPressable>
          {unpairError ? (
            <Text accessibilityRole="alert" style={styles.error}>{t(unpairError)}</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsSection({
  icon: Icon,
  title,
  theme,
  children,
}: {
  icon: typeof Laptop;
  title: string;
  theme: ConnectTheme;
  children: React.ReactNode;
}): React.ReactElement {
  const styles = createStyles(theme);
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Icon color={theme.colors.text2} size={18} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <View style={styles.rows}>{children}</View>
    </View>
  );
}

function FactRow({
  label,
  value,
  valueTone = 'default',
  theme,
}: {
  label: string;
  value: string;
  valueTone?: 'default' | 'secondary' | 'ok';
  theme: ConnectTheme;
}): React.ReactElement {
  const styles = createStyles(theme);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        numberOfLines={1}
        style={[
          styles.rowValue,
          valueTone === 'secondary' ? styles.rowValueSecondary : null,
          valueTone === 'ok' ? styles.rowValueOk : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function PublicLinkRow({
  configured,
  icon: Icon = ExternalLink,
  kind,
  label,
  pending,
  theme,
  onPress,
}: {
  configured: boolean;
  icon?: typeof ExternalLink;
  kind: PublicLinkKind;
  label: string;
  pending: boolean;
  theme: ConnectTheme;
  onPress(): void;
}): React.ReactElement {
  const styles = createStyles(theme);
  const disabled = !configured || pending;
  return (
    <MotionPressable
      accessibilityLabel={configured ? t('打开{label}', { label }) : t('{label}尚未配置', { label })}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.publicLinkRow, disabled ? styles.disabled : null]}
      testID={`public-link-${kind}`}
    >
      <View style={styles.publicLinkLabel}>
        <Icon color={theme.colors.text2} size={18} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={styles.publicLinkValue}>
        <Text style={styles.rowValueSecondary}>{configured ? t('打开') : t('尚未配置')}</Text>
        {configured ? <ChevronRight color={theme.colors.text3} size={18} /> : null}
      </View>
    </MotionPressable>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.bg },
    header: {
      minHeight: 52,
      paddingHorizontal: SPACE.x4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      alignItems: 'center',
      flexDirection: 'row',
    },
    backButton: {
      width: 44,
      height: 44,
      marginLeft: -SPACE.x3,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
    content: { paddingHorizontal: SPACE.x4, paddingVertical: SPACE.x3, paddingBottom: SPACE.x6 },
    section: { marginBottom: SPACE.x5 },
    groupToggle: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: SPACE.x1,
    },
    groupTitle: {
      color: theme.colors.text3,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: SPACE.x1,
      textTransform: 'uppercase',
    },
    sectionHeading: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    sectionTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
    rows: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
    },
    row: {
      minHeight: 52,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.x3,
    },
    rowLabel: { color: theme.colors.text2, fontSize: 14, fontWeight: '600' },
    rowValue: {
      minWidth: 0,
      flexShrink: 1,
      color: theme.colors.text,
      fontSize: 14,
      textAlign: 'right',
    },
    rowValueSecondary: { color: theme.colors.text3 },
    rowValueOk: { color: theme.colors.ok },
    avatarRow: {
      minHeight: 64,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.x3,
    },
    avatarValue: { flexDirection: 'row', alignItems: 'center', gap: SPACE.x2 },
    publicLinkRow: {
      minHeight: 52,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.x3,
    },
    publicLinkLabel: { flexDirection: 'row', alignItems: 'center', gap: SPACE.x2 },
    publicLinkValue: { flexDirection: 'row', alignItems: 'center', gap: SPACE.x1 },
    avatarImage: { width: 46, height: 46, borderRadius: 23 },
    avatarFallback: {
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      backgroundColor: theme.colors.panel2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarFallbackText: { color: theme.colors.text2, fontSize: 16, fontWeight: '700' },
    inlineError: { color: theme.colors.danger, fontSize: 12, lineHeight: 18, paddingVertical: SPACE.x2 },
    segmentedControl: {
      minHeight: 52,
      padding: SPACE.x1,
      borderWidth: 1,
      borderColor: theme.colors.line,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel,
      flexDirection: 'row',
      gap: SPACE.x1,
    },
    segment: {
      minWidth: 0,
      minHeight: 44,
      flex: 1,
      paddingHorizontal: SPACE.x2,
      borderRadius: RADIUS.control,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x1,
    },
    segmentSelected: { backgroundColor: theme.colors.panel2 },
    segmentLabel: {
      minWidth: 0,
      flexShrink: 1,
      color: theme.colors.text3,
      fontSize: 13,
      fontWeight: '600',
      textAlign: 'center',
    },
    segmentLabelSelected: { color: theme.colors.text },
    shortcutList: { paddingTop: SPACE.x2 },
    shortcutRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.x2,
    },
    shortcutOptions: {
      flexDirection: 'row',
      gap: SPACE.x1,
      flexShrink: 1,
    },
    shortcutOption: {
      minWidth: 58,
      minHeight: 36,
      paddingHorizontal: SPACE.x1,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dangerSection: {
      marginTop: SPACE.x1,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      paddingTop: SPACE.x3,
    },
    dangerAction: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: SPACE.x2,
    },
    dangerLabel: { color: theme.colors.danger, fontSize: 14, fontWeight: '700' },
    error: {
      color: theme.colors.danger,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    disabled: { opacity: 0.45 },
  });
}
