/**
 * 网页镜像「最后一帧」缓存：沿用终端「最后一屏」的口径（ADR-003 §19 引用户
 * 2026-09-29 拍板的同族规则）——单个文件、有字节上限、绑定配对 Mac、24 小时后
 * 从磁盘删除、解绑即删。过期的内容在这里真的移除，而不是只是不再显示。
 */
export const BROWSER_LAST_FRAME_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 超过这个大小的 JPEG 不缓存：低清档典型 30–100KB，1 MiB 已是安全余量。 */
export const BROWSER_LAST_FRAME_MAX_BYTES = 1024 * 1024;

export interface BrowserLastFrame {
  v: 1;
  savedAtMs: number;
  /** 配对桌面身份：别的 Mac 的画面绝不能在这里出现。 */
  desktopKey: string;
  workspaceLabel: string;
  title: string;
  jpegBase64: string;
  byteLength: number;
  viewportWidth: number;
  viewportHeight: number;
  encodedWidth: number;
  encodedHeight: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const isCount = (value: unknown, max: number): value is number => (
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
);
const isLabel = (value: unknown): value is string => (
  typeof value === 'string' && value.length >= 1 && value.length <= 160
);
const isBase64 = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length >= 4
  && value.length <= Math.ceil(BROWSER_LAST_FRAME_MAX_BYTES / 3) * 4 + 4
  && value.length % 4 === 0
  && /^[A-Za-z0-9+/]+={0,2}$/u.test(value)
);

/** 超限的画面直接不缓存：一张更旧的、更小的画面冒充「最后一帧」比空白更糟。 */
export function browserLastFrameFrom(input: {
  desktopKey: string;
  workspaceLabel: string;
  title: string;
  jpegBase64: string;
  byteLength: number;
  viewportWidth: number;
  viewportHeight: number;
  encodedWidth: number;
  encodedHeight: number;
}, nowMs: number): BrowserLastFrame | null {
  if (input.byteLength < 1 || input.byteLength > BROWSER_LAST_FRAME_MAX_BYTES) return null;
  if (input.desktopKey.length === 0) return null;
  return {
    v: 1,
    savedAtMs: nowMs,
    desktopKey: input.desktopKey,
    workspaceLabel: input.workspaceLabel.slice(0, 160),
    title: input.title.slice(0, 160),
    jpegBase64: input.jpegBase64,
    byteLength: input.byteLength,
    viewportWidth: input.viewportWidth,
    viewportHeight: input.viewportHeight,
    encodedWidth: input.encodedWidth,
    encodedHeight: input.encodedHeight,
  };
}

export function browserLastFrameMatches(
  cached: BrowserLastFrame | null,
  identity: { desktopKey: string },
  nowMs: number,
): cached is BrowserLastFrame {
  return cached !== null
    && cached.desktopKey === identity.desktopKey
    && nowMs - cached.savedAtMs >= 0
    && nowMs - cached.savedAtMs <= BROWSER_LAST_FRAME_MAX_AGE_MS;
}

/** 磁盘上的内容重新校验：坏文件显示空白，而不是带崩界面。 */
export function parseBrowserLastFrame(value: unknown): BrowserLastFrame | null {
  if (
    !isObject(value)
    || value.v !== 1
    || !isCount(value.savedAtMs, Number.MAX_SAFE_INTEGER)
    || typeof value.desktopKey !== 'string'
    || value.desktopKey.length === 0
    || !isLabel(value.workspaceLabel)
    || !isLabel(value.title)
    || !isBase64(value.jpegBase64)
    || !isCount(value.byteLength, BROWSER_LAST_FRAME_MAX_BYTES)
    || !isCount(value.viewportWidth, 65_535)
    || !isCount(value.viewportHeight, 65_535)
    || !isCount(value.encodedWidth, 65_535)
    || !isCount(value.encodedHeight, 65_535)
  ) return null;
  return value as unknown as BrowserLastFrame;
}

export interface BrowserLastFrameFilePort {
  read(): string | null;
  write(text: string): void;
  remove(): void;
}

export class BrowserLastFrameStore {
  constructor(private readonly file: BrowserLastFrameFilePort) {}

  load(nowMs: number = Date.now()): BrowserLastFrame | null {
    try {
      const text = this.file.read();
      if (text === null) return null;
      const parsed = parseBrowserLastFrame(JSON.parse(text) as unknown);
      const age = parsed === null ? -1 : nowMs - parsed.savedAtMs;
      if (parsed === null || age < 0 || age > BROWSER_LAST_FRAME_MAX_AGE_MS) {
        this.clear();
        return null;
      }
      return parsed;
    } catch {
      this.clear();
      return null;
    }
  }

  save(frame: BrowserLastFrame): void {
    try {
      this.file.write(JSON.stringify(frame));
    } catch {
      // 写不进去只意味着下次要空白等待，不额外打扰。
    }
  }

  clear(): void {
    try {
      this.file.remove();
    } catch {
      // 没有可删的内容。
    }
  }
}
