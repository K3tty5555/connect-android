import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { KindIcon } from './KindIcon';
import type { ConnectTheme } from '../theme/theme';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { currentLanguage, t } from '../i18n';

export interface ConnectionBarProps {
  deviceName: string;
  connection: 'unpaired' | 'online' | 'confirming' | 'reconnecting' | 'offline';
  isDemo: boolean;
  theme: ConnectTheme;
  /** 行尾操作（如首页的设置入口）；放在合并朗读的身份组之外，读屏仍能单独聚焦。 */
  trailing?: ReactNode;
}

const CONNECTION_LABELS: Record<ConnectionBarProps['connection'], string> = {
  unpaired: '尚未绑定',
  online: '在线',
  confirming: '正在确认',
  reconnecting: '正在重连',
  offline: '离线',
};

export function ConnectionBar({
  deviceName,
  connection,
  isDemo,
  theme,
  trailing,
}: ConnectionBarProps): React.ReactElement {
  const styles = createStyles(theme);
  const separator = currentLanguage() === 'en' ? ', ' : '，';
  const statusColor = connection === 'online'
    ? theme.colors.ok
    : connection === 'confirming' || connection === 'reconnecting'
      ? theme.colors.warn
      : theme.colors.text3;

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityLabel={`${deviceName}${separator}${t(CONNECTION_LABELS[connection])}${isDemo ? `${separator}${t('演示')}` : ''}`}
        style={styles.summary}
      >
        <View style={styles.identity}>
          <KindIcon kind="shell" size={20} theme={theme} />
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.deviceName}>{deviceName}</Text>
        </View>
        <View style={styles.statusGroup}>
          <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={[styles.status, { color: statusColor }]}>
            {t(CONNECTION_LABELS[connection])}
          </Text>
          {isDemo ? <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={styles.demo}>{t('演示')}</Text> : null}
        </View>
      </View>
      {trailing}
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      minHeight: 48,
      paddingHorizontal: SPACE.x3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.line,
      backgroundColor: theme.colors.bg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x1,
    },
    summary: {
      minWidth: 0,
      flex: 1,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.x3,
    },
    identity: {
      minWidth: 0,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    deviceName: {
      flexShrink: 1,
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    statusGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    status: {
      fontSize: 14,
      fontWeight: '600',
    },
    demo: {
      overflow: 'hidden',
      paddingHorizontal: SPACE.x2,
      paddingVertical: SPACE.x1,
      borderRadius: RADIUS.pill,
      backgroundColor: theme.colors.panel2,
      color: theme.colors.text2,
      fontSize: 12,
      fontWeight: '600',
    },
  });
}
