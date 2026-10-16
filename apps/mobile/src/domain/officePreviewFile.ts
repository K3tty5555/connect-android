import { Directory, File, Paths } from 'expo-file-system';
import { protectFileComplete } from '../../modules/connect-terminal';
import { mobileOfficeMime } from '../../../../src/shared/mobileFileBoundary';

/**
 * Word / Excel 的手机预览（FILES-OFFICE-PREVIEW-1013）交给系统自带渲染（WKWebView 内置的 Office 预览，
 * 与「文件」App 同源）。实测（iOS 26.5 模拟器探针，2026-10-14）：它只认 file:// 文档，data: URL 一律空白，
 * 所以这里是图片/PDF「只在内存」原则唯一的例外——
 * - 只写进 App 自己的缓存目录下的专用子目录，每次只留当前一个文件，查看器关闭即删；
 * - 每次写入前清空该目录；本次进程首次用到时也先清一次（崩溃或被杀后的残留下次打开即清）；
 * - 每个文件以 complete 数据保护封存，锁屏时不可读；封存不了就不落盘、不预览（与终端上次画面 F-04 同口径）。
 */

export const OFFICE_PREVIEW_DIRECTORY = 'connect-office-preview';

export interface OfficePreviewFiles {
  /** 写入并封存，返回 { uri, directoryUri }；扩展名不是 Office 或封存失败时抛错且不留文件。 */
  write(subPath: string, bytes: Uint8Array): { uri: string; directoryUri: string };
  remove(uri: string): void;
  clear(): void;
}

function filePath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//u, ''));
}

export function createExpoOfficePreviewFiles(
  protect: ((path: string) => boolean) | null = protectFileComplete,
  randomName: () => string = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
): OfficePreviewFiles {
  const directory = new Directory(Paths.cache, OFFICE_PREVIEW_DIRECTORY);
  const clear = (): void => {
    if (directory.exists) directory.delete();
  };
  return {
    write(subPath, bytes) {
      const extension = subPath.slice(subPath.lastIndexOf('.') + 1).toLowerCase();
      if (mobileOfficeMime(subPath) === null) throw new Error('not an office document');
      clear();
      directory.create({ idempotent: true });
      // 文件名不带原名：缓存目录里不留项目路径或文件名
      const file = new File(directory, `${randomName()}.${extension}`);
      file.create();
      file.write(bytes);
      if (protect === null || !protect(filePath(file.uri))) {
        file.delete();
        throw new Error('office preview could not be protected');
      }
      return { uri: file.uri, directoryUri: directory.uri };
    },
    remove(uri) {
      const file = new File(uri);
      if (file.exists) file.delete();
    },
    clear,
  };
}
