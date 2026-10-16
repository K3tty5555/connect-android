import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { reanimatedReduceMotion } from '../theme/reducedMotion';
import { MOTION } from '../theme/tokens';

export function SheetStepTransition({
  primary,
  primaryEstimatedHeight,
  reducedMotion,
  secondary,
  secondaryActive,
  secondaryEstimatedHeight,
}: {
  primary: ReactNode;
  primaryEstimatedHeight: number;
  reducedMotion: boolean;
  secondary: ReactNode;
  secondaryActive: boolean;
  secondaryEstimatedHeight: number;
}): React.ReactElement {
  const progress = useSharedValue(secondaryActive ? 1 : 0);
  const frameHeight = useSharedValue(
    secondaryActive ? secondaryEstimatedHeight : primaryEstimatedHeight,
  );
  const measured = useRef<[number | null, number | null]>([null, null]);
  const activeSecondaryRef = useRef(secondaryActive);
  activeSecondaryRef.current = secondaryActive;
  const reduceMotion = reanimatedReduceMotion(reducedMotion);

  useEffect(() => {
    progress.value = withTiming(secondaryActive ? 1 : 0, {
      duration: reducedMotion ? 0 : MOTION.moderate01,
      easing: Easing.bezier(0, 0, 0.38, 0.9),
      reduceMotion,
    });
    const measuredHeight = measured.current[secondaryActive ? 1 : 0];
    frameHeight.value = withTiming(
      measuredHeight ?? (secondaryActive ? secondaryEstimatedHeight : primaryEstimatedHeight),
      {
        duration: reducedMotion ? 0 : MOTION.moderate02,
        easing: Easing.bezier(0.2, 0, 0.38, 0.9),
        reduceMotion,
      },
    );
  }, [
    frameHeight,
    primaryEstimatedHeight,
    progress,
    reduceMotion,
    reducedMotion,
    secondaryActive,
    secondaryEstimatedHeight,
  ]);

  const measure = (index: 0 | 1) => (event: LayoutChangeEvent): void => {
    const height = event.nativeEvent.layout.height;
    const initialMeasurement = measured.current[index] === null;
    measured.current[index] = height;
    if ((index === 1) !== activeSecondaryRef.current) return;
    if (initialMeasurement) {
      frameHeight.value = height;
      return;
    }
    frameHeight.value = withTiming(height, {
      duration: reducedMotion ? 0 : MOTION.moderate02,
      easing: Easing.bezier(0.2, 0, 0.38, 0.9),
      reduceMotion,
    });
  };
  const frameStyle = useAnimatedStyle(() => ({ height: frameHeight.value }));
  const primaryStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateX: progress.value * -6 }],
  }));
  const secondaryStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * 6 }],
  }));

  return (
    <Animated.View style={[styles.frame, frameStyle]} testID="surface-create-step-frame">
      <Animated.View
        accessibilityElementsHidden={secondaryActive}
        importantForAccessibility={secondaryActive ? 'no-hide-descendants' : 'auto'}
        onLayout={measure(0)}
        pointerEvents={secondaryActive ? 'none' : 'auto'}
        style={[styles.layer, primaryStyle, { zIndex: secondaryActive ? 0 : 1 }]}
        testID="surface-create-step-new"
      >
        {primary}
      </Animated.View>
      <Animated.View
        accessibilityElementsHidden={!secondaryActive}
        importantForAccessibility={secondaryActive ? 'auto' : 'no-hide-descendants'}
        onLayout={measure(1)}
        pointerEvents={secondaryActive ? 'auto' : 'none'}
        style={[styles.layer, secondaryStyle, { zIndex: secondaryActive ? 1 : 0 }]}
        testID="surface-create-step-project"
      >
        {secondary}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  frame: { minWidth: 0, overflow: 'hidden', position: 'relative' },
  layer: { position: 'absolute', top: 0, right: 0, left: 0 },
});
