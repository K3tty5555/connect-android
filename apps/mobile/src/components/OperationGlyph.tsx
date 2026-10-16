import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
} from 'lucide-react-native';
import {
  operationPresentation,
  type OperationPhase,
} from '../domain/operationPresentation';
import type { ConnectTheme } from '../theme/theme';
import { useReducedMotion } from '../theme/reducedMotion';

export function OperationGlyph({
  phase,
  theme,
  idle,
  size = 20,
  staticProgress = false,
  transientSuccessMs,
  testID,
}: {
  phase: OperationPhase;
  theme: ConnectTheme;
  idle?: ReactNode;
  size?: number;
  staticProgress?: boolean;
  transientSuccessMs?: number;
  testID?: string;
}): React.ReactElement {
  const presentation = operationPresentation(phase);
  const reducedMotion = useReducedMotion();
  const [successVisible, setSuccessVisible] = useState(true);
  useEffect(() => {
    if (phase !== 'completed' || transientSuccessMs === undefined) {
      setSuccessVisible(true);
      return;
    }
    setSuccessVisible(true);
    const timer = setTimeout(() => setSuccessVisible(false), transientSuccessMs);
    return () => clearTimeout(timer);
  }, [phase, transientSuccessMs]);
  let content = idle ?? null;
  if (presentation.showProgress) {
    content = reducedMotion || staticProgress
      ? <Clock3 color={theme.colors.accent} size={size} />
      : <ActivityIndicator color={theme.colors.accent} size="small" />;
  } else if (presentation.showAccepted) {
    content = <Check color={theme.colors.ok} size={size} />;
  } else if (presentation.showCompleted && successVisible) {
    content = <CircleCheck color={theme.colors.ok} size={size} />;
  } else if (presentation.showFailure) {
    content = <CircleAlert color={theme.colors.danger} size={size} />;
  } else if (presentation.showAmbiguous) {
    content = <CircleHelp color={theme.colors.warn} size={size} />;
  }
  return (
    <View
      style={[styles.frame, { width: size + 4, height: size + 4 }]}
      testID={testID ?? `operation-${phase}`}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
