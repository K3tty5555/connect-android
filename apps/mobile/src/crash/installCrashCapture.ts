/**
 * Imported first by index.ts (ADR-008): wraps React Native's global error
 * handler before anything else runs. Only the pure handler is loaded here; the
 * file system and native module are required lazily, on the first fatal error
 * or after the first tick, so this import cannot itself fail the start-up.
 */
import { installJsFatalHandler, type GlobalErrorUtils } from './jsFatalHandler';
import { mobileCrashContext } from './crashContext';

type ExpoCrashLog = typeof import('./expoCrashLog');

try {
  installJsFatalHandler({
    errorUtils: (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils,
    context: mobileCrashContext(),
    record: (entry) => {
      (require('./expoCrashLog') as ExpoCrashLog).mobileCrashLogStore().record(entry);
    },
  });
} catch {
  // Never block the App from starting.
}

setTimeout(() => {
  try {
    (require('./expoCrashLog') as ExpoCrashLog).collectMobilePreviousExits();
  } catch {
    // ignore
  }
}, 0);
