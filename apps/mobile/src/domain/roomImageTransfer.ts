import { bytesToBase64, concatBytes } from '../net/bytes';
import type {
  MobileCommand,
  MobileEvent,
  MobileRoomImageMime,
} from '../net/bridgeClient';

export const ROOM_IMAGE_CHUNK_BYTES = 64 * 1024;
export const ROOM_IMAGE_MAX_BYTES = 5_000_000;
export const ROOM_IMAGE_MESSAGE_MAX_BYTES = 12 * 1024 * 1024;
export const ROOM_IMAGE_MAX_COUNT = 4;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface PreparedRoomImage {
  id: string;
  uri: string;
  mime: MobileRoomImageMime;
  bytes: Uint8Array;
  sha256: string;
}

export interface DownloadedRoomImage {
  mime: MobileRoomImageMime;
  bytes: Uint8Array;
  dataUri: string;
}

export class RoomImageCommitAmbiguousError extends Error {}
export class RoomImageTransferBusyError extends Error {}

type ImageTransferEvent = Extract<MobileEvent, {
  kind:
    | 'roomImageUploadReady'
    | 'roomImageChunkAccepted'
    | 'roomSendAccepted'
    | 'roomImageDownloadReady'
    | 'roomImageDownloadChunk'
    | 'error';
}>;

interface PendingEvent {
  expected: ImageTransferEvent['kind'];
  accept(event: ImageTransferEvent): boolean;
  resolve(event: ImageTransferEvent): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface RoomImageTransferOptions {
  send(command: MobileCommand): Promise<void>;
  requestId(): string;
  digest(bytes: Uint8Array): Promise<string>;
  timeoutMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class RoomImageTransferCoordinator {
  private readonly pending = new Map<string, PendingEvent>();
  private readonly timeoutMs: number;
  private readonly schedule: NonNullable<RoomImageTransferOptions['schedule']>;
  private readonly cancelSchedule: NonNullable<RoomImageTransferOptions['cancelSchedule']>;
  private active: 'uploading' | 'committing' | 'downloading' | null = null;

  constructor(private readonly options: RoomImageTransferOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  }

  get busy(): boolean {
    return this.active !== null;
  }

  get activity(): 'uploading' | 'committing' | 'downloading' | null {
    return this.active;
  }

  handle(event: MobileEvent): boolean {
    if (!('requestId' in event) || event.requestId === undefined) return false;
    const pending = this.pending.get(event.requestId);
    if (pending === undefined) return false;
    this.pending.delete(event.requestId);
    this.cancelSchedule(pending.timer);
    if (event.kind === 'error') {
      pending.reject(new Error(event.message ?? event.code));
      return true;
    }
    if (event.kind !== pending.expected || !pending.accept(event as ImageTransferEvent)) {
      pending.reject(new Error('unexpected room image acknowledgement'));
      return true;
    }
    pending.resolve(event as ImageTransferEvent);
    return true;
  }

  cancelForDisconnect(): boolean {
    const commitAmbiguous = this.active === 'committing';
    const error = commitAmbiguous
      ? new RoomImageCommitAmbiguousError('room image commit result is ambiguous')
      : new Error('room image transfer disconnected');
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      this.cancelSchedule(pending.timer);
      pending.reject(error);
    }
    return commitAmbiguous;
  }

  cancelCurrent(): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      this.cancelSchedule(pending.timer);
      pending.reject(new Error('room image transfer cancelled'));
    }
  }

  async uploadAndCommit(input: {
    roomCapability: string;
    text: string;
    images: readonly PreparedRoomImage[];
  }): Promise<void> {
    this.begin('uploading');
    try {
      validatePreparedImages(input.text, input.images);
      const uploadCapabilities: string[] = [];
      for (const image of input.images) {
        const beginRequestId = this.options.requestId();
        const ready = await this.request({
          kind: 'beginRoomImageUpload',
          requestId: beginRequestId,
          roomCapability: input.roomCapability,
          mime: image.mime,
          byteLength: image.bytes.byteLength,
          sha256: image.sha256,
          chunkCount: Math.ceil(image.bytes.byteLength / ROOM_IMAGE_CHUNK_BYTES),
        }, 'roomImageUploadReady', (event) => (
          event.kind === 'roomImageUploadReady'
          && event.roomCapability === input.roomCapability
        ));
        if (ready.kind !== 'roomImageUploadReady') throw new Error('invalid upload acknowledgement');
        uploadCapabilities.push(ready.uploadCapability);
        const chunkCount = Math.ceil(image.bytes.byteLength / ROOM_IMAGE_CHUNK_BYTES);
        for (let index = 0; index < chunkCount; index += 1) {
          const chunkRequestId = this.options.requestId();
          const chunk = image.bytes.subarray(
            index * ROOM_IMAGE_CHUNK_BYTES,
            Math.min(image.bytes.byteLength, (index + 1) * ROOM_IMAGE_CHUNK_BYTES),
          );
          await this.request({
            kind: 'roomImageChunk',
            requestId: chunkRequestId,
            uploadCapability: ready.uploadCapability,
            index,
            data: bytesToBase64(chunk),
          }, 'roomImageChunkAccepted', (event) => (
            event.kind === 'roomImageChunkAccepted'
            && event.uploadCapability === ready.uploadCapability
            && event.nextIndex === index + 1
          ));
        }
      }
      this.active = 'committing';
      const commitRequestId = this.options.requestId();
      await this.request({
        kind: 'commitRoomMessage',
        requestId: commitRequestId,
        roomCapability: input.roomCapability,
        text: input.text,
        uploadCapabilities,
      }, 'roomSendAccepted', (event) => (
        event.kind === 'roomSendAccepted'
        && event.roomCapability === input.roomCapability
      ));
    } finally {
      this.active = null;
    }
  }

  async download(input: {
    roomCapability: string;
    messageId: string;
    imageIndex: number;
  }): Promise<DownloadedRoomImage> {
    this.begin('downloading');
    try {
      const beginRequestId = this.options.requestId();
      const ready = await this.request({
        kind: 'beginRoomImageDownload',
        requestId: beginRequestId,
        ...input,
      }, 'roomImageDownloadReady', (event) => (
        event.kind === 'roomImageDownloadReady'
        && event.roomCapability === input.roomCapability
        && event.messageId === input.messageId
        && event.imageIndex === input.imageIndex
      ));
      if (ready.kind !== 'roomImageDownloadReady') throw new Error('invalid download acknowledgement');
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (let index = 0; index < ready.chunkCount; index += 1) {
        const requestId = this.options.requestId();
        const event = await this.request({
          kind: 'readRoomImageChunk',
          requestId,
          imageCapability: ready.imageCapability,
          index,
        }, 'roomImageDownloadChunk', (candidate) => (
          candidate.kind === 'roomImageDownloadChunk'
          && candidate.imageCapability === ready.imageCapability
          && candidate.index === index
          && candidate.complete === (index === ready.chunkCount - 1)
        ));
        if (event.kind !== 'roomImageDownloadChunk') throw new Error('invalid download chunk');
        const bytes = decodeCanonicalBase64(event.data);
        const expected = index === ready.chunkCount - 1
          ? ready.byteLength - index * ROOM_IMAGE_CHUNK_BYTES
          : ROOM_IMAGE_CHUNK_BYTES;
        if (bytes.byteLength !== expected) throw new Error('room image chunk length mismatch');
        received += bytes.byteLength;
        chunks.push(bytes);
      }
      if (received !== ready.byteLength) throw new Error('room image length mismatch');
      const bytes = concatBytes(...chunks);
      if (await this.options.digest(bytes) !== ready.sha256) {
        throw new Error('room image digest mismatch');
      }
      return {
        mime: ready.mime,
        bytes,
        dataUri: `data:${ready.mime};base64,${bytesToBase64(bytes)}`,
      };
    } finally {
      this.active = null;
    }
  }

  private begin(kind: NonNullable<RoomImageTransferCoordinator['active']>): void {
    if (this.active !== null) throw new RoomImageTransferBusyError('room image transfer is busy');
    this.active = kind;
  }

  private request<K extends Exclude<ImageTransferEvent['kind'], 'error'>>(
    command: MobileCommand & { requestId: string },
    expected: K,
    accept: (event: Extract<ImageTransferEvent, { kind: K }>) => boolean,
  ): Promise<Extract<ImageTransferEvent, { kind: K }>> {
    return new Promise((resolve, reject) => {
      const fail = (error: Error): void => reject(error);
      const timer = this.schedule(() => {
        if (!this.pending.delete(command.requestId)) return;
        reject(this.active === 'committing'
          ? new RoomImageCommitAmbiguousError('room image commit timed out')
          : new Error('room image transfer timed out'));
      }, this.timeoutMs);
      this.pending.set(command.requestId, {
        expected,
        accept: (event) => accept(event as Extract<ImageTransferEvent, { kind: K }>),
        resolve: (event) => resolve(event as Extract<ImageTransferEvent, { kind: K }>),
        reject: fail,
        timer,
      });
      void this.options.send(command).catch((error: unknown) => {
        const pending = this.pending.get(command.requestId);
        if (pending === undefined) return;
        this.pending.delete(command.requestId);
        this.cancelSchedule(timer);
        pending.reject(this.active === 'committing'
          ? new RoomImageCommitAmbiguousError('room image commit result is ambiguous')
          : error instanceof Error ? error : new Error('room image command failed'));
      });
    });
  }
}

function validatePreparedImages(text: string, images: readonly PreparedRoomImage[]): void {
  if (text.length > 20_000 || (text.trim().length === 0 && images.length === 0)) {
    throw new Error('room message is empty or too long');
  }
  if (images.length > ROOM_IMAGE_MAX_COUNT) throw new Error('too many room images');
  let total = 0;
  for (const image of images) {
    if (
      image.bytes.byteLength < 1
      || image.bytes.byteLength > ROOM_IMAGE_MAX_BYTES
      || !/^[0-9a-f]{64}$/u.test(image.sha256)
      || (image.mime !== 'image/png' && image.mime !== 'image/jpeg')
    ) throw new Error('invalid prepared room image');
    total += image.bytes.byteLength;
  }
  if (total > ROOM_IMAGE_MESSAGE_MAX_BYTES) throw new Error('room images exceed message limit');
}

function decodeCanonicalBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytesToBase64(bytes) !== value) throw new Error('invalid room image base64');
  return bytes;
}
