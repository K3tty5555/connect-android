import { AccessibilityInfo } from 'react-native';
import {
  ReduceMotion,
  ReducedMotionConfig,
} from 'react-native-reanimated';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

const ReducedMotionContext = createContext(false);
const EVENT = 'reduceMotionChanged' as const;

export function reanimatedReduceMotion(reduced: boolean): ReduceMotion {
  return reduced ? ReduceMotion.Always : ReduceMotion.Never;
}

export function ReducedMotionProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    let nativeChangeObserved = false;
    const onChange = (value: boolean): void => {
      nativeChangeObserved = true;
      if (mounted) setReduced(value);
    };
    const subscription = AccessibilityInfo.addEventListener(EVENT, onChange);
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted && !nativeChangeObserved) setReduced(value);
    }).catch(() => {});
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Prefer one motion-free frame over playing motion before the native setting resolves.
  const resolved = reduced ?? true;
  return (
    <ReducedMotionContext.Provider value={resolved}>
      <ReducedMotionConfig mode={reanimatedReduceMotion(resolved)} />
      {children}
    </ReducedMotionContext.Provider>
  );
}

export function useReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}
