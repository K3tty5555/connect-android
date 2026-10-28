import { Claude, Codex } from '@lobehub/icons-rn';
import { Globe, MessagesSquare, SquareTerminal } from 'lucide-react-native';
import { View } from 'react-native';
import { STORE_SHOT } from '../storeShot';
import type { SurfaceKind } from '../domain/session';
import type { ConnectTheme } from '../theme/theme';

/** 网页镜像条目（ADR-003 §19）复用会话行的图标位：Globe 线形、次级文字色（与桌面 KindIcon 同口径）。 */
export type PanelIconKind = SurfaceKind | 'web';

export function KindIcon({
  kind,
  size,
  theme,
}: {
  kind: PanelIconKind;
  size: number;
  theme: ConnectTheme;
}): React.ReactElement {
  // Store screenshots do not carry vendor marks (brand-review.md §5): a plain
  // identity-colour dot stands in, the same one the promo artwork uses.
  if (STORE_SHOT !== null && (kind === 'claude' || kind === 'codex')) {
    const dot = Math.round(size * 0.58);
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: kind === 'claude' ? theme.colors.claude : theme.colors.codex,
          }}
        />
      </View>
    );
  }
  if (kind === 'claude') {
    return <Claude size={size} color={theme.colors.claude} />;
  }
  if (kind === 'codex') {
    return <Codex size={size} color={theme.colors.codex} />;
  }
  if (kind === 'collaboration') {
    return <MessagesSquare size={size} color={theme.colors.text2} />;
  }
  if (kind === 'web') {
    return <Globe size={size} color={theme.colors.text2} />;
  }
  return <SquareTerminal size={size} color={theme.colors.shell} />;
}
