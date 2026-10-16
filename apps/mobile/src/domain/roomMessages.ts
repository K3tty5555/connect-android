import type { MobileRoomMessage } from '../net/bridgeClient';

const MAX_ROOM_MESSAGES = 512;
const MAX_ROOM_MESSAGE_BYTES = 1_100_000;

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function createPendingRoomMessage(
  requestId: string,
  text: string,
  nowMs = Date.now(),
): MobileRoomMessage {
  return {
    id: `m-local-${requestId.replace(/^req_/u, '')}`,
    from: 'user',
    text,
    ts: nowMs,
    pending: true,
  };
}

export function removeRoomMessage(
  messages: readonly MobileRoomMessage[],
  messageId: string,
): MobileRoomMessage[] {
  return messages.filter((message) => message.id !== messageId);
}

export function mergeBoundedRoomMessages(
  existing: readonly MobileRoomMessage[],
  incoming: readonly MobileRoomMessage[],
): { messages: MobileRoomMessage[]; omittedMessages: number } {
  const byId = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  const merged = [...byId.values()].sort((left, right) => (
    left.ts - right.ts || left.id.localeCompare(right.id)
  ));
  let start = merged.length;
  let bytes = 0;
  while (start > 0 && merged.length - start < MAX_ROOM_MESSAGES) {
    const messageBytes = utf8Bytes(JSON.stringify(merged[start - 1]!));
    if (messageBytes > MAX_ROOM_MESSAGE_BYTES) break;
    if (bytes > 0 && bytes + messageBytes > MAX_ROOM_MESSAGE_BYTES) break;
    bytes += messageBytes;
    start -= 1;
  }
  return {
    messages: merged.slice(start),
    omittedMessages: start,
  };
}
