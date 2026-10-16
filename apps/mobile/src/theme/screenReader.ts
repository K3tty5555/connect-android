import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

const EVENT = 'screenReaderChanged' as const;

/** Keeps xterm's expensive accessibility tree off unless a native reader is active. */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (mounted) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener(EVENT, setEnabled);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
