import { File, Paths } from 'expo-file-system';
import { protectFileComplete } from '../../modules/connect-terminal';
import type { LastScreenFilePort } from './lastScreenStore';

export const LAST_SCREEN_FILE_NAME = 'connect-last-screen.v1.json';

/**
 * In the App's own caches directory: the system may purge it, which only costs
 * a blank wait next time. Every write is sealed with complete data protection,
 * unreadable while the phone is locked (acceptance 2026-09-30 F-04). Where that
 * cannot be applied the file is not kept at all: a weaker copy of a terminal
 * screen is worse than a blank wait.
 */
/** React Native's URL polyfill does not implement pathname; a file URI is simple enough to read directly. */
function filePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

export function createExpoLastScreenFile(
  protect: ((path: string) => boolean) | null = protectFileComplete,
): LastScreenFilePort {
  const file = new File(Paths.cache, LAST_SCREEN_FILE_NAME);
  return {
    read: () => (file.exists ? file.textSync() : null),
    write: (text) => {
      if (!file.exists) file.create();
      file.write(text);
      if (protect === null || !protect(filePath(file.uri))) {
        file.delete();
        throw new Error('last screen could not be protected');
      }
    },
    remove: () => {
      if (file.exists) file.delete();
    },
  };
}
