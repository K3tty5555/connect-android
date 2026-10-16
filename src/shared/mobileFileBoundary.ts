/**
 * ADR-003 §14 移动工作区文件的共用边界：Mac 桥与手机客户端都引用这里，不各写一份常量。
 * 纯 TS、无 Node 依赖（手机端经 metro watchFolders 直接 import）。
 */

/** 单块原始字节上限：base64 后 1 MiB，再经帧加密 base64 仍低于 2,000,000 B 的帧上限。 */
export const MOBILE_FILE_CHUNK_BYTES = 768 * 1024;
/** 文本与 Mac 同口径（MAX_WORKSPACE_FILE_BYTES）。 */
export const MOBILE_FILE_TEXT_MAX_BYTES = 2 * 1024 * 1024;
/** 媒体与 Mac 预览同口径（MAX_WORKSPACE_PREVIEW_BYTES）。 */
export const MOBILE_FILE_MEDIA_MAX_BYTES = 16 * 1024 * 1024;
export const MOBILE_FILE_MAX_CHUNKS = Math.ceil(MOBILE_FILE_MEDIA_MAX_BYTES / MOBILE_FILE_CHUNK_BYTES);
/** 手机端编辑保存上限：序列化转义后仍须装进单帧。 */
export const MOBILE_FILE_SAVE_MAX_BYTES = 512 * 1024;
export const MOBILE_FILE_DOWNLOAD_TTL_MS = 120_000;
export const MOBILE_FILE_LIST_MAX_ENTRIES = 1000;

/**
 * 工作区相对路径的形状校验。空串 = 根。只挡形状（绝对路径、`.`/`..`/空段、NUL、超长）；
 * 真正的越界判定永远由桌面 realpath 根内校验完成，这里通过不代表授权。
 */
export function isMobileWorkspaceSubPath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return true;
  if (value.length > 4096 || value.includes('\0')) return false;
  if (value.startsWith('/')) return false;
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function isMobileWorkspaceEntryName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && !value.includes('/')
    && !value.includes('\0')
    && value !== '.'
    && value !== '..';
}

export function joinMobileSubPath(dir: string, name: string): string {
  return dir.length === 0 ? name : `${dir}/${name}`;
}

export function parentMobileSubPath(subPath: string): string {
  const index = subPath.lastIndexOf('/');
  return index < 0 ? '' : subPath.slice(0, index);
}

export function mobileFileChunkCount(byteLength: number): number {
  return byteLength === 0 ? 0 : Math.ceil(byteLength / MOBILE_FILE_CHUNK_BYTES);
}

/**
 * 手机用系统自带渲染（WKWebView 内置的 Office 预览）显示的 Office 类型。docx/xlsx 的标准 MIME 超过
 * fileOpened.mime 的 64 字符上限，所以桥不下发 MIME，两端都按请求路径的扩展名查这张表。
 */
const MOBILE_OFFICE_MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

export function mobileOfficeMime(subPath: string): string | null {
  const name = subPath.slice(subPath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return MOBILE_OFFICE_MIME[name.slice(dot + 1).toLowerCase()] ?? null;
}
