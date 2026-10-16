import { StyleSheet, Text, View } from 'react-native';
import type {
  MobileIntent,
  SessionViewModel,
  TaskPhase,
} from '../domain/session';
import { availableTaskIntents } from '../domain/session';
import type { ConnectTheme } from '../theme/theme';
import { KindIcon } from './KindIcon';
import { MAX_COMPACT_FONT_SCALE, RADIUS, SPACE } from '../theme/tokens';
import { MotionPressable } from './MotionPressable';
import { OperationGlyph } from './OperationGlyph';
import { t } from '../i18n';

export interface TaskActionBarProps {
  state: SessionViewModel;
  theme: ConnectTheme;
  onIntent(intent: MobileIntent): void;
}

const AGENT_LABELS: Record<SessionViewModel['agent'], string> = {
  claude: 'Claude',
  codex: 'Codex',
  shell: '终端',
};

const PHASE_LABELS: Record<TaskPhase, string> = {
  idle: '空闲',
  running: '正在运行',
  stopping: '正在停止',
  waiting_confirmation: '等待确认',
  retryable_failure: '可重试',
  action_required: '需要处理',
  failed: '已失败',
  ambiguous: '状态待确认',
  stopped: '已停止',
  completed: '已完成',
};

const INTENT_LABELS: Partial<Record<MobileIntent, {
  visible: string;
  accessibility: string;
}>> = {
  stop: { visible: '停止', accessibility: '停止当前任务' },
  approve: { visible: '批准', accessibility: '批准当前操作' },
  reject: { visible: '拒绝', accessibility: '拒绝当前操作' },
  retry: { visible: '重试', accessibility: '重试当前任务' },
  reconnect: { visible: '重新连接', accessibility: '重新连接' },
};

export function TaskActionBar({
  state,
  theme,
  onIntent,
}: TaskActionBarProps): React.ReactElement | null {
  const styles = createStyles(theme);
  const agentColor = state.agent === 'claude'
    ? theme.colors.claude
    : state.agent === 'codex'
      ? theme.colors.codex
      : theme.colors.shell;
  const intents = availableTaskIntents(state).filter(
    (intent) => INTENT_LABELS[intent] !== undefined,
  );
  const pendingLabel = state.pendingIntent === null
    ? undefined
    : INTENT_LABELS[state.pendingIntent];
  if (
    intents.length === 0
    && pendingLabel === undefined
    && ['idle', 'stopped', 'completed'].includes(state.taskPhase)
  ) return null;

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityLabel={`${t(AGENT_LABELS[state.agent])}, ${t(PHASE_LABELS[state.taskPhase])}`}
        style={styles.agentStatus}
      >
        <KindIcon kind={state.agent} size={20} theme={theme} />
        <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={[styles.agent, { color: agentColor }]}>
          {t(AGENT_LABELS[state.agent])}
        </Text>
        <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} numberOfLines={1} style={styles.phase}>
          {t(PHASE_LABELS[state.taskPhase])}
        </Text>
      </View>
      <View style={styles.actions}>
        {pendingLabel ? (
          <MotionPressable
            accessibilityLabel={t('正在处理 {action}', { action: t(pendingLabel.visible) })}
            accessibilityRole="button"
            accessibilityState={{ busy: true, disabled: true }}
            disabled
            style={[styles.action, styles.pendingAction]}
          >
            <OperationGlyph phase="pending" size={18} theme={theme} />
            <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={[styles.actionText, { color: theme.colors.accent }]}>
              {t(pendingLabel.visible)}
            </Text>
          </MotionPressable>
        ) : null}
        {intents.map((intent) => {
          const label = INTENT_LABELS[intent];
          if (!label) return null;
          const disabled = state.pendingIntent !== null;
          return (
            <MotionPressable
              accessibilityLabel={t(label.accessibility)}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              key={intent}
              onPress={() => onIntent(intent)}
              style={[
                styles.action,
                { borderColor: intentColor(intent, theme) },
                disabled ? styles.actionDisabled : null,
              ]}
            >
              <Text maxFontSizeMultiplier={MAX_COMPACT_FONT_SCALE} style={[styles.actionText, {
                color: intentColor(intent, theme),
              }]}>
                {t(label.visible)}
              </Text>
            </MotionPressable>
          );
        })}
      </View>
    </View>
  );
}

function intentColor(intent: MobileIntent, theme: ConnectTheme): string {
  if (intent === 'stop') return theme.colors.danger;
  if (intent === 'approve') return theme.colors.ok;
  if (intent === 'reject') return theme.colors.text2;
  return theme.colors.accent;
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      minHeight: 54,
      paddingLeft: SPACE.x3,
      paddingRight: SPACE.x2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.line,
      backgroundColor: theme.colors.panel,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.x3,
    },
    agentStatus: {
      minWidth: 0,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    agent: {
      fontSize: 15,
      fontWeight: '700',
    },
    phase: {
      flexShrink: 1,
      color: theme.colors.text2,
      fontSize: 14,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.x2,
    },
    action: {
      minWidth: 72,
      minHeight: 44,
      paddingHorizontal: SPACE.x3,
      borderWidth: 1,
      borderRadius: RADIUS.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pendingAction: {
      flexDirection: 'row',
      gap: SPACE.x1,
    },
    actionDisabled: {
      opacity: 0.5,
    },
    actionText: {
      fontSize: 15,
      fontWeight: '700',
    },
  });
}
