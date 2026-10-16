// Metro-local projection of src/core/loadingPresentation.ts; equality is locked by tests.
export const LOADING_BAND_THRESHOLD_MS = Object.freeze({
  brief: 120,
  waiting: 600,
  long: 2_000,
});

export type LoadingBand = 'idle' | 'instant' | 'brief' | 'waiting' | 'long';

export interface LoadingPresentation {
  band: LoadingBand;
  elapsedMs: number;
  showPending: boolean;
  showPlaceholder: boolean;
  showRecovery: boolean;
}

export function loadingPresentationAt(
  active: boolean,
  elapsedMs: number,
): LoadingPresentation {
  const elapsed = Math.max(0, elapsedMs);
  if (!active) return presentation('idle', 0, false, false, false);
  if (elapsed < LOADING_BAND_THRESHOLD_MS.brief) {
    return presentation('instant', elapsed, false, false, false);
  }
  if (elapsed < LOADING_BAND_THRESHOLD_MS.waiting) {
    return presentation('brief', elapsed, true, false, false);
  }
  if (elapsed < LOADING_BAND_THRESHOLD_MS.long) {
    return presentation('waiting', elapsed, true, true, false);
  }
  return presentation('long', elapsed, true, true, true);
}

function presentation(
  band: LoadingBand,
  elapsedMs: number,
  showPending: boolean,
  showPlaceholder: boolean,
  showRecovery: boolean,
): LoadingPresentation {
  return { band, elapsedMs, showPending, showPlaceholder, showRecovery };
}
