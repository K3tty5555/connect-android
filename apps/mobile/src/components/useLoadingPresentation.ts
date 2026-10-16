import { useEffect, useState } from 'react';
import {
  LOADING_BAND_THRESHOLD_MS,
  loadingPresentationAt,
  type LoadingPresentation,
} from './loadingPresentation';

export function useLoadingPresentation(active: boolean): LoadingPresentation {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(0);
    if (!active) return;
    const timers = Object.values(LOADING_BAND_THRESHOLD_MS).map((threshold) => (
      setTimeout(() => setElapsedMs(threshold), threshold)
    ));
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return loadingPresentationAt(active, active ? elapsedMs : 0);
}
