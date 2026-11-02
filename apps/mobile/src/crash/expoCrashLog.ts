import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { drainCrashDiagnostics, recentExitReasons } from '../../modules/connect-terminal';
import { createCrashDiagnostics, type CrashDiagnostics } from './crashDiagnostics';
import { mobileCrashContext, mobileCrashUploadUrl } from './crashContext';
import { CrashLogStore } from './crashLogStore';
import { collectPreviousExits } from './previousExits';

/**
 * In the document directory, not the cache: the system may purge caches, and
 * this log is for the crashes users report days later (ADR-008).
 */
export const CRASH_LOG_FILE_NAME = 'connect-crash.jsonl';
export const CRASH_LOG_ROTATED_FILE_NAME = 'connect-crash.1.jsonl';
/** Newest Android exit already copied into the log. */
export const CRASH_SEEN_FILE_NAME = 'connect-crash-seen.json';

// Fresh File objects per call: `moveSync` re-points the File it is called on
// at the destination, so a long-lived "active" handle would follow the rotation.
const CRASH_SENT_FILE_NAME = 'connect-crash-sent.json';
const documentFile = (name: string): File => new File(Paths.document, name);

let store: CrashLogStore | null = null;

export function mobileCrashLogStore(): CrashLogStore {
  store ??= new CrashLogStore({
    size: () => {
      const active = documentFile(CRASH_LOG_FILE_NAME);
      return active.exists ? active.size : 0;
    },
    append: (text) => {
      const active = documentFile(CRASH_LOG_FILE_NAME);
      if (!active.exists) active.create();
      active.write(text, { append: true });
    },
    rotate: () => {
      const rotated = documentFile(CRASH_LOG_ROTATED_FILE_NAME);
      if (rotated.exists) rotated.delete();
      const active = documentFile(CRASH_LOG_FILE_NAME);
      if (active.exists) active.moveSync(documentFile(CRASH_LOG_ROTATED_FILE_NAME));
    },
    read: () => {
      const rotated = documentFile(CRASH_LOG_ROTATED_FILE_NAME);
      const active = documentFile(CRASH_LOG_FILE_NAME);
      return [rotated.exists ? rotated.textSync() : '', active.exists ? active.textSync() : ''];
    },
  });
  return store;
}

/** Idempotent: the same exit is copied once (Android marker, iOS drain). Never throws. */
export function collectMobilePreviousExits(): void {
  try {
    const log = mobileCrashLogStore();
    collectPreviousExits({
      platform: Platform.OS,
      native: { recentExitReasons, drainCrashDiagnostics },
      marker: {
        read: () => {
          const file = documentFile(CRASH_SEEN_FILE_NAME);
          return file.exists ? file.textSync() : null;
        },
        write: (text) => {
          const file = documentFile(CRASH_SEEN_FILE_NAME);
          if (!file.exists) file.create();
          file.write(text);
        },
      },
      record: (entry) => { log.record(entry); },
      context: mobileCrashContext(),
    });
  } catch {
    // Diagnostics never break the App.
  }
}

export function createMobileCrashDiagnostics(): CrashDiagnostics | undefined {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return undefined;
  const platform = Platform.OS;
  return createCrashDiagnostics({
    readEntries: () => {
      // MetricKit may deliver after launch; pick it up when the user looks.
      collectMobilePreviousExits();
      return mobileCrashLogStore().entries();
    },
    platform,
    appVersion: mobileCrashContext().appVersion,
    uploadUrl: mobileCrashUploadUrl(),
    randomId: () => Crypto.randomUUID(),
    // Fingerprint of the last successful send (ADR-008 revision 2026-11-01).
    sentMarker: {
      read: () => {
        const file = documentFile(CRASH_SENT_FILE_NAME);
        if (!file.exists) return null;
        const key = (JSON.parse(file.textSync()) as { key?: unknown }).key;
        return typeof key === 'string' ? key : null;
      },
      write: (key) => {
        const file = documentFile(CRASH_SENT_FILE_NAME);
        if (!file.exists) file.create();
        file.write(JSON.stringify({ key }));
      },
    },
  });
}
