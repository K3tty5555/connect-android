import type { ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  reanimatedReduceMotion,
  useReducedMotion,
} from '../theme/reducedMotion';
import { playInteractionFeedback } from '../theme/interactionFeedback';
import { MOTION } from '../theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface MotionPressableProps extends Omit<PressableProps, 'children' | 'style'> {
  children: ReactNode;
  feedback?: 'selection';
  style?: StyleProp<ViewStyle>;
}

/** Carbon productive timing: immediate acknowledgement, no bounce or decorative scale. */
export function MotionPressable({
  children,
  disabled,
  feedback,
  onPress,
  onPressIn,
  onPressOut,
  style,
  ...props
}: MotionPressableProps): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const pressedOpacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: disabled ? 0.4 : pressedOpacity.value,
  }), [disabled]);
  const animate = (value: number, duration: number): void => {
    pressedOpacity.value = withTiming(value, {
      duration: reducedMotion ? 0 : duration,
      easing: Easing.bezier(0.2, 0, 0.38, 0.9),
      reduceMotion: reanimatedReduceMotion(reducedMotion),
    });
  };

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPress={(event) => {
        onPress?.(event);
        if (feedback === 'selection') {
          void playInteractionFeedback({
            action: 'selection',
            origin: 'user',
            phase: 'completed',
          });
        }
      }}
      onPressIn={(event) => {
        animate(0.7, MOTION.fast01);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1, MOTION.fast02);
        onPressOut?.(event);
      }}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
