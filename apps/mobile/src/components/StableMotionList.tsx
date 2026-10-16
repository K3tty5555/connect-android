import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated as NativeAnimated,
  Easing as NativeEasing,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  Keyframe,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { reanimatedReduceMotion } from '../theme/reducedMotion';
import { MOTION } from '../theme/tokens';

interface StableListTombstone {
  readonly id: string;
  readonly itemKey: string;
  readonly index: number;
}

export type StableListEntry<T> =
  | {
      readonly type: 'item';
      readonly key: string;
      readonly item: T;
      readonly entering: boolean;
    }
  | {
      readonly type: 'tombstone';
      readonly key: string;
      readonly id: string;
      readonly itemKey: string;
    };

export function useStableListEntries<T>(
  items: readonly T[],
  keyFor: (item: T) => string,
  reducedMotion: boolean,
): {
  entries: StableListEntry<T>[];
  finishExit(id: string): void;
} {
  const keys = items.map(keyFor);
  const keySignature = JSON.stringify(keys);
  const previousKeys = useRef(keys);
  const generation = useRef(0);
  const [tombstones, setTombstones] = useState<readonly StableListTombstone[]>([]);
  useLayoutEffect(() => {
    const prior = previousKeys.current;
    previousKeys.current = keys;
    if (reducedMotion) {
      setTombstones((current) => current.length === 0 ? current : []);
      return;
    }
    const liveKeys = new Set(keys);
    setTombstones((current) => {
      const next = current.filter((entry) => !liveKeys.has(entry.itemKey));
      const retainedKeys = new Set(next.map((entry) => entry.itemKey));
      for (let index = 0; index < prior.length; index += 1) {
        const itemKey = prior[index]!;
        if (liveKeys.has(itemKey) || retainedKeys.has(itemKey)) continue;
        generation.current += 1;
        next.push({ id: `exit:${generation.current}`, itemKey, index });
      }
      const unchanged = next.length === current.length
        && next.every((entry, index) => entry === current[index]);
      return unchanged ? current : next;
    });
  }, [keySignature, reducedMotion]);
  const finishExit = useCallback((id: string): void => {
    setTombstones((current) => current.filter((entry) => entry.id !== id));
  }, []);
  const previousKeySet = new Set(previousKeys.current);
  const entries: StableListEntry<T>[] = items.map((item) => ({
    type: 'item',
    key: keyFor(item),
    item,
    entering: !previousKeySet.has(keyFor(item)),
  }));
  for (const tombstone of [...tombstones].sort((a, b) => a.index - b.index)) {
    entries.splice(Math.min(tombstone.index, entries.length), 0, {
      type: 'tombstone',
      key: tombstone.id,
      id: tombstone.id,
      itemKey: tombstone.itemKey,
    });
  }
  return { entries, finishExit };
}

export function StableMotionRow({
  animateEnter = false,
  children,
  reducedMotion,
  style,
  testID,
}: {
  animateEnter?: boolean;
  children: ReactNode;
  reducedMotion: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}): React.ReactElement {
  const enter = useMemo(() => reducedMotion || !animateEnter ? undefined : new Keyframe({
    0: { opacity: 0, transform: [{ translateY: 2 }] },
    100: {
      opacity: 1,
      transform: [{ translateY: 0 }],
      easing: Easing.bezier(0, 0, 0.38, 0.9),
    },
  }).duration(MOTION.moderate01).reduceMotion(reanimatedReduceMotion(reducedMotion)), [animateEnter, reducedMotion]);
  const layout = useMemo(() => reducedMotion ? undefined : new LinearTransition()
    .duration(MOTION.moderate02)
    .easing(Easing.bezier(0.2, 0, 0.38, 0.9))
    .reduceMotion(reanimatedReduceMotion(reducedMotion)), [reducedMotion]);
  return (
    <Animated.View entering={enter} layout={layout} style={style} testID={testID}>
      {children}
    </Animated.View>
  );
}

export function StableListExit({
  height,
  onComplete,
  reducedMotion,
  style,
  testID,
}: {
  height: number;
  onComplete(): void;
  reducedMotion: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
}): React.ReactElement {
  const animatedHeight = useRef(new NativeAnimated.Value(height)).current;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  useEffect(() => {
    if (reducedMotion) {
      onCompleteRef.current();
      return;
    }
    const animation = NativeAnimated.timing(animatedHeight, {
      duration: MOTION.fast02,
      easing: NativeEasing.bezier(0.2, 0, 0.38, 0.9),
      toValue: 0,
      useNativeDriver: false,
    });
    animation.start();
    const finishTimer = setTimeout(() => onCompleteRef.current(), MOTION.fast02);
    return () => {
      clearTimeout(finishTimer);
      animation.stop();
    };
  }, [animatedHeight, reducedMotion]);
  return (
    <NativeAnimated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.exit, style, { height: animatedHeight }]}
      testID={testID}
    />
  );
}

export function SelectionIndicator({
  children,
  reducedMotion,
  selected,
  style,
  testID,
}: {
  children: ReactNode;
  reducedMotion: boolean;
  selected: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
}): React.ReactElement {
  const progress = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(selected ? 1 : 0, {
      duration: reducedMotion ? 0 : MOTION.fast02,
      easing: Easing.bezier(0.2, 0, 0.38, 0.9),
      reduceMotion: reanimatedReduceMotion(reducedMotion),
    });
  }, [progress, reducedMotion, selected]);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: (1 - progress.value) * 2 }],
  }));
  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.indicator, style, animatedStyle]}
      testID={testID}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  exit: { minHeight: 0, overflow: 'hidden' },
  indicator: {
    width: 24,
    height: 24,
    flex: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
