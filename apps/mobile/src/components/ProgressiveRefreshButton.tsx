import { type StyleProp, type ViewStyle } from 'react-native';
import { RefreshCw } from 'lucide-react-native';
import {
  operationPresentation,
  type OperationPhase,
} from '../domain/operationPresentation';
import type { ConnectTheme } from '../theme/theme';
import { useReducedMotion } from '../theme/reducedMotion';
import { t } from '../i18n';
import { MotionPressable } from './MotionPressable';
import { OperationGlyph } from './OperationGlyph';
import { useLoadingPresentation } from './useLoadingPresentation';

export type RefreshStatus = OperationPhase;

export function ProgressiveRefreshButton({
  idleLabel,
  pendingLabel,
  onRefresh,
  status,
  style,
  theme,
  size = 20,
}: {
  idleLabel: string;
  pendingLabel: string;
  onRefresh(): void;
  status: RefreshStatus;
  style: StyleProp<ViewStyle>;
  theme: ConnectTheme;
  size?: number;
}): React.ReactElement {
  const operation = operationPresentation(status);
  const pending = status === 'pending' || status === 'streaming';
  const presentation = useLoadingPresentation(pending);
  const reducedMotion = useReducedMotion();
  const label = status === 'failed'
    ? t('刷新失败，重试')
    : status === 'ambiguous'
      ? t('刷新结果待确认，重试')
      : status === 'accepted'
        ? t('电脑已接受刷新')
        : status === 'completed'
          ? t('刷新完成')
    : presentation.showRecovery
      ? t('等待电脑响应')
      : pending ? pendingLabel : idleLabel;
  const visualState = status === 'failed' || status === 'ambiguous'
    ? status
    : status === 'accepted' || status === 'completed'
      ? status
    : !presentation.showPending
      ? 'idle'
      : presentation.showRecovery || reducedMotion ? 'waiting' : 'progress';
  const disabled = operation.busy;

  return (
    <MotionPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: operation.busy, disabled }}
      disabled={disabled}
      onPress={onRefresh}
      style={style}
      testID={`refresh-${visualState}`}
    >
      <OperationGlyph
        idle={<RefreshCw color={theme.colors.text2} size={size} />}
        phase={status}
        size={size}
        staticProgress={presentation.showRecovery}
        transientSuccessMs={1_200}
        theme={theme}
      />
    </MotionPressable>
  );
}
