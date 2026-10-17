import { View } from 'react-native';
import type { MobilePanelStatus } from '../../../../src/shared/types';
import type { ConnectTheme } from '../theme/theme';
import { t } from '../i18n';

/**
 * The desktop's single lamp, on the phone (MOBILE-SESSION-RUN-STATE-01, user
 * 2026-10-17): red = needs you (input, error or a new result), yellow = running,
 * green = idle. Connection state lives in the connection bar, not here.
 */
export type LampTone = 'attention' | 'running' | 'idle';

export function lampTone(status: MobilePanelStatus): LampTone {
  if (status === 'running') return 'running';
  if (status === 'idle') return 'idle';
  return 'attention';
}

export function panelStatusLabel(status: MobilePanelStatus): string {
  switch (status) {
    case 'needs_input': return t('等你输入');
    case 'error': return t('出错');
    case 'unread': return t('有新结果');
    case 'running': return t('运行中');
    case 'idle': return t('空闲');
  }
}

/** A project shows its most urgent panel; no known panel shows no lamp. */
export function aggregateLampTone(statuses: readonly (MobilePanelStatus | undefined)[]): LampTone | null {
  const known = statuses.filter((status): status is MobilePanelStatus => status !== undefined).map(lampTone);
  if (known.length === 0) return null;
  if (known.includes('attention')) return 'attention';
  if (known.includes('running')) return 'running';
  return 'idle';
}

export function aggregateLampLabel(tone: LampTone): string {
  if (tone === 'attention') return t('需要你查看');
  if (tone === 'running') return t('运行中');
  return t('全部完成');
}

export function PanelStatusLamp({
  tone,
  label,
  theme,
  size = 8,
  testID,
}: {
  tone: LampTone;
  label: string;
  theme: ConnectTheme;
  size?: number;
  testID?: string;
}): React.ReactElement {
  const color = tone === 'attention'
    ? theme.colors.lampRed
    : tone === 'running'
      ? theme.colors.lampYellow
      : theme.colors.lampGreen;
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="image"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }}
      testID={testID}
    />
  );
}
