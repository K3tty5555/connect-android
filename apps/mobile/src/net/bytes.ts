import { utf8ToBytes } from '@noble/hashes/utils.js';

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (
    value.length === 0
    || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)
  ) {
    throw new Error('invalid base64');
  }
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

export function textToBytes(value: string): Uint8Array {
  return utf8ToBytes(value);
}

export function bytesToText(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

/**
 * WebSocket onmessage 的 data 还原成文本。中转层(用户 Relay 等)可能把桌面发来的
 * 文本帧当 Buffer 重发成二进制帧,React Native 会把二进制帧投递成 ArrayBuffer;
 * 协议层只认 string,所以这里按 UTF-8 解回文本。解不了返回 null。
 */
export function socketDataToText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return bytesToText(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) return bytesToText(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return null;
}

export function uint32be(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('value must fit uint32');
  }
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, false);
  return output;
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}
