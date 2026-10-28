/**
 * 内置网页面板手机镜像的共享协议常量与二进制帧编解码（ADR-003 §19，MOBILE-BROWSER-PREVIEW-1023 第 1b 步）。
 *
 * 只放纯类型、常量与编解码：不 import node / electron，桌面主进程与手机端（RN）都能直接使用。
 * 画面帧不走 JSON 事件——JSON + base64 + 密文 base64 约 1.78 倍膨胀，640 宽的实时画面会把 Relay 带宽打穿；
 * 因此 browserFrame 用自定义头的**二进制 WebSocket 帧**承载（头 + AES-GCM 密文 JPEG），头里带 seq 与视口元数据。
 */

export type MobileBrowserViewTierRequest = 'auto' | 'low' | 'high';
/** 实际生效的档位：auto 按连接方式解析；congested 是连续 Ack 超时后的拥塞兜底。 */
export type MobileBrowserResolvedTier = 'low' | 'high' | 'congested';

export interface MobileBrowserTierParams {
  /** screencast / 截图的目标宽度（物理像素上限）。 */
  width: number;
  /** JPEG 质量 1–100。 */
  quality: number;
  /** 每秒最多送出的帧数。 */
  maxFps: number;
  /** 令牌桶补充速率（字节/秒），即单路带宽上限。 */
  bytesPerSecond: number;
  /** 令牌桶容量（字节）：允许的瞬时突发。 */
  burstBytes: number;
}

/** Relay / Tailscale 中继档（用户拍板 2026-10-26：640 宽、≤3 帧/秒、单路 ≤1Mbps）。 */
export const BROWSER_TIER_LOW: MobileBrowserTierParams = {
  width: 640,
  quality: 40,
  maxFps: 3,
  bytesPerSecond: 125_000,
  burstBytes: 125_000,
};
/** 局域网 / Tailscale 直连档：1024 宽、q60、≤10 帧/秒。 */
export const BROWSER_TIER_HIGH: MobileBrowserTierParams = {
  width: 1024,
  quality: 60,
  maxFps: 10,
  bytesPerSecond: 500_000,
  burstBytes: 250_000,
};
/** 拥塞兜底：480 宽、q30、2 帧/秒。 */
export const BROWSER_TIER_CONGESTED: MobileBrowserTierParams = {
  width: 480,
  quality: 30,
  maxFps: 2,
  bytesPerSecond: 64_000,
  burstBytes: 96_000,
};

export const BROWSER_MIRROR_TIERS: Record<MobileBrowserResolvedTier, MobileBrowserTierParams> = {
  low: BROWSER_TIER_LOW,
  high: BROWSER_TIER_HIGH,
  congested: BROWSER_TIER_CONGESTED,
};

export const BROWSER_MIRROR_LIMITS = {
  /** 静止多久后补一张清晰帧。 */
  sharpFrameDelayMs: 500,
  /** 手机连续无操作多久后暂停推流。 */
  idlePauseMs: 120_000,
  /** 手机逐帧 Ack 超时：超时按已确认处理并重发最新帧（自愈），连续两次降档。 */
  ackTimeoutMs: 10_000,
  /** 输入限频：每秒最多接受的事件数（ADR-003 §19）。 */
  inputEventsPerSecond: 60,
  /** insertText 单次上限（设计 §5.3）。 */
  insertTextMaxLength: 2000,
  /** wheel 单事件 delta 上限（绝对值）。 */
  wheelDeltaMax: 10_000,
  /** browserView start/stop 每分钟上限。 */
  viewStartPerMinute: 12,
  /** browserTakeover 每分钟上限。 */
  takeoverPerMinute: 10,
  /** browserNav 每分钟上限。 */
  navPerMinute: 30,
  /** 单帧密文上限：再大的帧按损坏丢弃（防内存放大）。 */
  frameCipherMaxBytes: 4 * 1024 * 1024,
} as const;

/** 桌面遮罩期间本机键盘暂存上限：与 PTY 收回语义一致，超出的丢弃。 */
export const BROWSER_LOCAL_KEY_BUFFER_MAX = 8;

/**
 * 手机按键白名单（设计 §5.3）：退格、回车、Tab、Esc、方向键、Home/End、PageUp/Down。
 * 不含任意字符键——文字一律走 insertText（中文输入法只送上屏后的文字）。
 */
export const BROWSER_KEY_WHITELIST = [
  'backspace',
  'enter',
  'tab',
  'escape',
  'arrow-up',
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'home',
  'end',
  'page-up',
  'page-down',
] as const;
export type MobileBrowserKeyName = (typeof BROWSER_KEY_WHITELIST)[number];

// ── 二进制帧封装 ──────────────────────────────────────────────────────────────
//
// 布局（大端，共 44 字节头 + AES-GCM 密文 JPEG）：
//   [0..4)    magic 'CBF1'
//   [4..12)   counter uint64 —— 与 JSON 帧共用同一会话计数器空间（AEAD IV 唯一性）
//   [12..28)  GCM tag（16 字节原文，不 base64）
//   [28..32)  seq uint32 —— 本路画面帧序号，手机 Ack 与 baseFrameSeq 都用它
//   [32..34)  viewportWidth  uint16 —— CSS 视口宽（手机坐标映射的权威值）
//   [34..36)  viewportHeight uint16
//   [36..38)  encodedWidth   uint16 —— 本帧编码宽度
//   [38..40)  encodedHeight  uint16
//   [40]      flags：bit0 = 清晰帧（静止补帧）
//   [41..44)  保留，恒 0
//   [44..)    ciphertext：JPEG 字节的 AES-GCM 密文（解密后是裸 JPEG，无 base64）

export const BROWSER_FRAME_MAGIC = [0x43, 0x42, 0x46, 0x31] as const; // 'CBF1'
export const BROWSER_FRAME_HEADER_BYTES = 44;

export interface MobileBrowserFrameHeader {
  counter: number;
  tag: Uint8Array;
  seq: number;
  viewportWidth: number;
  viewportHeight: number;
  encodedWidth: number;
  encodedHeight: number;
  sharp: boolean;
}

export interface EncodedMobileBrowserFrame {
  header: MobileBrowserFrameHeader;
  /** 解密前的密文（JPEG）。 */
  cipher: Uint8Array;
}

export interface MobileBrowserFrameInput {
  counter: number;
  /** 16 字节 GCM tag。 */
  tag: Uint8Array;
  seq: number;
  viewportWidth: number;
  viewportHeight: number;
  encodedWidth: number;
  encodedHeight: number;
  sharp: boolean;
  cipher: Uint8Array;
}

export function encodeMobileBrowserFrame(input: MobileBrowserFrameInput): Uint8Array {
  if (input.tag.byteLength !== 16) throw new Error('browser frame tag must be 16 bytes');
  if (
    !Number.isSafeInteger(input.counter) || input.counter < 1
    || !Number.isSafeInteger(input.seq) || input.seq < 1
    || !Number.isSafeInteger(input.viewportWidth) || input.viewportWidth < 0 || input.viewportWidth > 0xffff
    || !Number.isSafeInteger(input.viewportHeight) || input.viewportHeight < 0 || input.viewportHeight > 0xffff
    || !Number.isSafeInteger(input.encodedWidth) || input.encodedWidth < 0 || input.encodedWidth > 0xffff
    || !Number.isSafeInteger(input.encodedHeight) || input.encodedHeight < 0 || input.encodedHeight > 0xffff
  ) {
    throw new Error('browser frame header out of range');
  }
  if (input.cipher.byteLength === 0 || input.cipher.byteLength > BROWSER_MIRROR_LIMITS.frameCipherMaxBytes) {
    throw new Error('browser frame cipher out of bounds');
  }
  const out = new Uint8Array(BROWSER_FRAME_HEADER_BYTES + input.cipher.byteLength);
  const view = new DataView(out.buffer);
  out[0] = BROWSER_FRAME_MAGIC[0];
  out[1] = BROWSER_FRAME_MAGIC[1];
  out[2] = BROWSER_FRAME_MAGIC[2];
  out[3] = BROWSER_FRAME_MAGIC[3];
  view.setUint32(4, Math.floor(input.counter / 2 ** 32));
  view.setUint32(8, input.counter >>> 0);
  out.set(input.tag, 12);
  view.setUint32(28, input.seq);
  view.setUint16(32, input.viewportWidth);
  view.setUint16(34, input.viewportHeight);
  view.setUint16(36, input.encodedWidth);
  view.setUint16(38, input.encodedHeight);
  out[40] = input.sharp ? 1 : 0;
  out[41] = 0;
  out[42] = 0;
  out[43] = 0;
  out.set(input.cipher, BROWSER_FRAME_HEADER_BYTES);
  return out;
}

export type DecodedMobileBrowserFrame =
  | { ok: true; frame: EncodedMobileBrowserFrame }
  | { ok: false };

export function decodeMobileBrowserFrame(bytes: Uint8Array): DecodedMobileBrowserFrame {
  if (bytes.byteLength <= BROWSER_FRAME_HEADER_BYTES) return { ok: false };
  if (bytes.byteLength > BROWSER_FRAME_HEADER_BYTES + BROWSER_MIRROR_LIMITS.frameCipherMaxBytes) {
    return { ok: false };
  }
  if (
    bytes[0] !== BROWSER_FRAME_MAGIC[0] || bytes[1] !== BROWSER_FRAME_MAGIC[1]
    || bytes[2] !== BROWSER_FRAME_MAGIC[2] || bytes[3] !== BROWSER_FRAME_MAGIC[3]
    || bytes[41] !== 0 || bytes[42] !== 0 || bytes[43] !== 0
    || (bytes[40] & 0xfe) !== 0
  ) {
    return { ok: false };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const counter = view.getUint32(4) * 2 ** 32 + view.getUint32(8);
  const seq = view.getUint32(28);
  if (!Number.isSafeInteger(counter) || counter < 1 || seq < 1) return { ok: false };
  return {
    ok: true,
    frame: {
      header: {
        counter,
        tag: bytes.slice(12, 28),
        seq,
        viewportWidth: view.getUint16(32),
        viewportHeight: view.getUint16(34),
        encodedWidth: view.getUint16(36),
        encodedHeight: view.getUint16(38),
        sharp: (bytes[40] & 1) === 1,
      },
      cipher: bytes.slice(BROWSER_FRAME_HEADER_BYTES),
    },
  };
}

/** 解析 JPEG 的 SOF 段拿编码尺寸（清晰帧 captureScreenshot 不回元数据，头里的 encodedWidth/Height 用它补齐）。 */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (offset + 9 > bytes.byteLength) return null;
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    if (marker === 0xda) return null; // 进入熵编码段还没见到 SOF
    offset += 2 + length;
  }
  return null;
}
