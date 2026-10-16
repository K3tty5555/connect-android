import type { ColorSchemeName } from 'react-native';
import type { MobileThemePreference } from '../../../../src/shared/types';
import { CONNECT_PALETTE } from './tokens';

export type ConnectTheme = {
  mode: 'dark' | 'light';
  colors: typeof CONNECT_PALETTE.dark | typeof CONNECT_PALETTE.light;
};

const THEMES: Record<ConnectTheme['mode'], ConnectTheme> = {
  dark: { mode: 'dark', colors: CONNECT_PALETTE.dark },
  light: { mode: 'light', colors: CONNECT_PALETTE.light },
};

export function themeFor(
  scheme: ColorSchemeName | null,
  preference: MobileThemePreference = 'system',
): ConnectTheme {
  const mode = preference === 'system'
    ? scheme === 'light' ? 'light' : 'dark'
    : preference;
  return THEMES[mode];
}
