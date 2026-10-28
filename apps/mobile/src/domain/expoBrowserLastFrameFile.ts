import { File, Paths } from 'expo-file-system';
import { protectFileComplete } from '../../modules/connect-terminal';
import type { BrowserLastFrameFilePort } from './browserLastFrame';

export const BROWSER_LAST_FRAME_FILE_NAME = 'connect-browser-last-frame.v1.json';

/** React Native's URL polyfill does not implement pathname; a file URI is simple enough to read directly. */
function filePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

/**
 * 与终端「最后一屏」同一口径（terminal/expoLastScreenFile）：App 自己的 caches
 * 目录、每次写入都加 complete 数据保护；加不上就不落盘——一张不受保护的网页
 * 画面比空白等待更糟。
 */
export function createExpoBrowserLastFrameFile(
  protect: ((path: string) => boolean) | null = protectFileComplete,
): BrowserLastFrameFilePort {
  const file = new File(Paths.cache, BROWSER_LAST_FRAME_FILE_NAME);
  return {
    read: () => (file.exists ? file.textSync() : null),
    write: (text) => {
      if (!file.exists) file.create();
      file.write(text);
      if (protect === null || !protect(filePath(file.uri))) {
        file.delete();
        throw new Error('browser last frame could not be protected');
      }
    },
    remove: () => {
      if (file.exists) file.delete();
    },
  };
}
