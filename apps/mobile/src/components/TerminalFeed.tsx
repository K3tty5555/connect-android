import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowDown } from 'lucide-react-native';
import { KeyboardChatScrollView } from 'react-native-keyboard-controller';
import type { AgentKind, TerminalLine } from '../domain/session';
import { currentPlatformPolicy } from '../platform/policy';
import { useReducedMotion } from '../theme/reducedMotion';
import type { ConnectTheme } from '../theme/theme';
import { RADIUS, SPACE } from '../theme/tokens';
import { t } from '../i18n';

export interface TerminalFeedProps {
  agent: AgentKind;
  lines: TerminalLine[];
  theme: ConnectTheme;
}

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  shell: '终端',
};

export function TerminalFeed({
  agent,
  lines,
  theme,
}: TerminalFeedProps): React.ReactElement {
  const styles = createStyles(theme);
  const policy = currentPlatformPolicy();
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<
    React.ComponentRef<typeof KeyboardChatScrollView>
  >(null);
  const [atLatest, setAtLatest] = useState(true);
  const toneColors: Record<TerminalLine['tone'], string> = {
    default: theme.colors.text2,
    agent: agent === 'claude'
      ? theme.colors.claude
      : agent === 'codex'
        ? theme.colors.codex
        : theme.colors.shell,
    success: theme.colors.ok,
    warning: theme.colors.warn,
    danger: theme.colors.danger,
  };

  return (
    <View
      accessibilityLabel={t('{agent} 终端输出', { agent: t(AGENT_LABELS[agent]) })}
      style={styles.container}
    >
      <KeyboardChatScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardDismissMode={policy.keyboardDismissMode}
        keyboardLiftBehavior="whenAtEnd"
        onEndVisible={setAtLatest}
        showsVerticalScrollIndicator={false}
        testID="terminal-feed-scroll"
      >
        {lines.map((line) => (
          <Text
            key={line.id}
            selectable
            style={[styles.line, { color: toneColors[line.tone] }]}
          >
            {line.text}
          </Text>
        ))}
      </KeyboardChatScrollView>
      {!atLatest && lines.length > 0 ? (
        <Pressable
          accessibilityLabel={t('回到最新')}
          accessibilityRole="button"
          onPress={() => {
            scrollRef.current?.scrollToEnd({ animated: !reducedMotion });
          }}
          style={styles.latest}
        >
          <ArrowDown color={theme.colors.text} size={20} />
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme: ConnectTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.bg,
      position: 'relative',
    },
    content: {
      flexGrow: 1,
      // Anchor output to the composer. KeyboardChatScrollView lifts content by
      // the keyboard height whenever the feed is at its end, and a short
      // top-anchored feed is trivially at its end — the lift would scroll the
      // only visible lines above the viewport. flex-end has no effect once
      // content overflows, so long feeds keep their existing scroll behaviour.
      justifyContent: 'flex-end',
      paddingHorizontal: SPACE.x4,
      paddingTop: SPACE.x5,
      paddingBottom: SPACE.x6,
      gap: SPACE.x3,
    },
    line: {
      fontFamily: 'monospace',
      fontSize: 15,
      lineHeight: 23,
    },
    latest: {
      position: 'absolute',
      right: SPACE.x4,
      bottom: SPACE.x3,
      minWidth: 44,
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.colors.line2,
      borderRadius: RADIUS.control,
      backgroundColor: theme.colors.panel2,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
