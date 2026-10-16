import { RefreshCw, X } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import type { OperationPhase } from '../domain/operationPresentation';
import type { SurfaceKind } from '../domain/session';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';
import { KindIcon } from './KindIcon';
import { MotionPressable } from './MotionPressable';
import { OperationGlyph } from './OperationGlyph';

export function SurfaceLifecyclePlaceholder({
  kind,
  status,
  error,
  theme,
  variant,
  onRetry,
  onDismiss,
}: {
  kind: SurfaceKind;
  status: OperationPhase;
  error?: string | null;
  theme: ConnectTheme;
  variant: 'row' | 'surface';
  onRetry(): void;
  onDismiss(): void;
}): React.ReactElement {
  const phase = status === 'idle' ? 'pending' : status;
  const failed = phase === 'failed';
  const ambiguous = phase === 'ambiguous';
  const label = failed
    ? t('创建失败')
    : ambiguous
      ? t('创建结果待确认')
      : phase === 'accepted' ? t('已挂载，正在确认') : t('正在准备');
  return (
    <View
      style={[styles.base, variant === 'row' ? styles.row : styles.surface, {
        backgroundColor: theme.colors.panel,
        borderColor: theme.colors.line,
      }]}
      testID={`surface-lifecycle-${variant}`}
    >
      <View
        accessibilityLabel={error ? `${label}。${t(error)}` : label}
        accessibilityLiveRegion="polite"
        accessibilityRole={failed || ambiguous ? 'alert' : 'progressbar'}
        style={styles.status}
      >
        <KindIcon kind={kind} size={22} theme={theme} />
        <OperationGlyph phase={phase} size={18} theme={theme} />
        <View style={styles.copy}>
          <Text numberOfLines={1} style={[styles.label, { color: theme.colors.text2 }]}>{label}</Text>
          {error ? (
            <Text numberOfLines={2} style={[styles.error, { color: failed ? theme.colors.danger : theme.colors.warn }]}>
              {t(error)}
            </Text>
          ) : null}
        </View>
      </View>
      {failed ? (
        <MotionPressable
          accessibilityLabel={t('重试创建')}
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.action}
        >
          <RefreshCw color={theme.colors.text2} size={19} />
        </MotionPressable>
      ) : null}
      {failed || ambiguous ? (
        <MotionPressable
          accessibilityLabel={t('关闭创建状态')}
          accessibilityRole="button"
          onPress={onDismiss}
          style={styles.action}
        >
          <X color={theme.colors.text3} size={19} />
        </MotionPressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.x2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: 72,
    marginHorizontal: SPACE.x3,
    paddingHorizontal: SPACE.x3,
    borderRadius: RADIUS.control,
  },
  surface: {
    position: 'absolute',
    zIndex: 4,
    inset: 0,
    justifyContent: 'center',
    paddingHorizontal: SPACE.x4,
  },
  status: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.x2,
  },
  copy: { minWidth: 0, flex: 1 },
  label: { fontSize: 13, fontWeight: '600' },
  error: { marginTop: SPACE.x1, fontSize: 11 },
  action: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
