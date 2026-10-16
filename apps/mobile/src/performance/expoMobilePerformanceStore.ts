import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { MobilePerformanceStore } from './mobilePerformanceStore';

export const MOBILE_PERFORMANCE_FILE_NAME = 'connect-mobile-performance.jsonl';
/** One rotated generation, same as the desktop's `mobile-performance.1.jsonl`. */
export const MOBILE_PERFORMANCE_ROTATED_FILE_NAME = 'connect-mobile-performance.1.jsonl';

/** The pre-rotation whole-file JSON document, which nothing writes any more. */
const LEGACY_FILE_NAME = 'connect-mobile-performance.json';

export function createExpoMobilePerformanceStore(): MobilePerformanceStore {
  const active = new File(Paths.cache, MOBILE_PERFORMANCE_FILE_NAME);
  const rotated = new File(Paths.cache, MOBILE_PERFORMANCE_ROTATED_FILE_NAME);
  // Leaving the old file behind would hand a stale run to whoever pulls the
  // documented path next — the same wrong-diagnosis failure this log exists to
  // prevent. Best effort: diagnostics must never break the App.
  try {
    const legacy = new File(Paths.cache, LEGACY_FILE_NAME);
    if (legacy.exists) legacy.delete();
  } catch {
    // ignore
  }
  return new MobilePerformanceStore({
    size: () => (active.exists ? active.size : 0),
    append: (text) => {
      if (!active.exists) active.create();
      active.write(text, { append: true });
    },
    rotate: () => {
      if (rotated.exists) rotated.delete();
      if (active.exists) active.moveSync(rotated);
    },
  }, {
    runtimeId: `runtime_${Crypto.randomUUID().replaceAll('-', '')}`,
  });
}
