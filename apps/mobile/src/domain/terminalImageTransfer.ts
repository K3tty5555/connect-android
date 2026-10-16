import { bytesToBase64 } from '../net/bytes';
import type { MobileCommand, MobileEvent } from '../net/bridgeClient';
import {
  ROOM_IMAGE_CHUNK_BYTES,
  ROOM_IMAGE_MAX_BYTES,
  type PreparedRoomImage,
} from './roomImageTransfer';

const DEFAULT_TIMEOUT_MS = 10_000;

export class TerminalImageCommitAmbiguousError extends Error {}
export class TerminalImageTransferBusyError extends Error {}

type TerminalImageEvent = Extract<MobileEvent, {
  kind:
    | 'terminalImageUploadReady'
    | 'terminalImageChunkAccepted'
    | 'terminalImageMessageAccepted'
    | 'error';
}>;

interface PendingEvent {
  expected: TerminalImageEvent['kind'];
  accept(event: TerminalImageEvent): boolean;
  resolve(event: TerminalImageEvent): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface TerminalImageTransferOptions {
  send(command: MobileCommand): Promise<void>;
  requestId(): string;
  timeoutMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class TerminalImageTransferCoordinator {
  private readonly pending = new Map<string, PendingEvent>();
  private readonly timeoutMs: number;
  private readonly schedule: NonNullable<TerminalImageTransferOptions['schedule']>;
  private readonly cancelSchedule: NonNullable<TerminalImageTransferOptions['cancelSchedule']>;
  private active: 'uploading' | 'committing' | null = null;

  constructor(private readonly options: TerminalImageTransferOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  }

  get busy(): boolean {
    return this.active !== null;
  }

  get activity(): 'uploading' | 'committing' | null {
    return this.active;
  }

  handle(event: MobileEvent): boolean {
    if (!('requestId' in event) || event.requestId === undefined) return false;
    const pending = this.pending.get(event.requestId);
    if (pending === undefined) return false;
    this.pending.delete(event.requestId);
    this.cancelSchedule(pending.timer);
    if (event.kind === 'error') {
      pending.reject(event.category === 'ambiguous'
        ? new TerminalImageCommitAmbiguousError(event.message ?? event.code)
        : new Error(event.message ?? event.code));
      return true;
    }
    if (event.kind !== pending.expected || !pending.accept(event as TerminalImageEvent)) {
      pending.reject(new Error('unexpected terminal image acknowledgement'));
      return true;
    }
    pending.resolve(event as TerminalImageEvent);
    return true;
  }

  cancelForDisconnect(): boolean {
    const ambiguous = this.active === 'committing';
    const error = ambiguous
      ? new TerminalImageCommitAmbiguousError('terminal image commit result is ambiguous')
      : new Error('terminal image transfer disconnected');
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      this.cancelSchedule(pending.timer);
      pending.reject(error);
    }
    return ambiguous;
  }

  async uploadAndCommit(input: {
    panelId: string;
    epoch: number;
    text: string;
    image: PreparedRoomImage;
  }): Promise<void> {
    if (this.active !== null) throw new TerminalImageTransferBusyError('terminal image transfer is busy');
    validateInput(input.text, input.image);
    this.active = 'uploading';
    try {
      const beginRequestId = this.options.requestId();
      const ready = await this.request({
        kind: 'beginTerminalImageUpload',
        requestId: beginRequestId,
        panelId: input.panelId,
        epoch: input.epoch,
        mime: input.image.mime,
        byteLength: input.image.bytes.byteLength,
        sha256: input.image.sha256,
        chunkCount: Math.ceil(input.image.bytes.byteLength / ROOM_IMAGE_CHUNK_BYTES),
      }, 'terminalImageUploadReady', (event) => (
        event.kind === 'terminalImageUploadReady' && event.panelId === input.panelId
      ));
      if (ready.kind !== 'terminalImageUploadReady') throw new Error('invalid upload acknowledgement');
      const chunkCount = Math.ceil(input.image.bytes.byteLength / ROOM_IMAGE_CHUNK_BYTES);
      for (let index = 0; index < chunkCount; index += 1) {
        const chunk = input.image.bytes.subarray(
          index * ROOM_IMAGE_CHUNK_BYTES,
          Math.min(input.image.bytes.byteLength, (index + 1) * ROOM_IMAGE_CHUNK_BYTES),
        );
        await this.request({
          kind: 'terminalImageChunk',
          requestId: this.options.requestId(),
          uploadCapability: ready.uploadCapability,
          index,
          data: bytesToBase64(chunk),
        }, 'terminalImageChunkAccepted', (event) => (
          event.kind === 'terminalImageChunkAccepted'
          && event.uploadCapability === ready.uploadCapability
          && event.nextIndex === index + 1
        ));
      }
      this.active = 'committing';
      await this.request({
        kind: 'commitTerminalImageMessage',
        requestId: this.options.requestId(),
        panelId: input.panelId,
        epoch: input.epoch,
        uploadCapability: ready.uploadCapability,
        text: input.text,
      }, 'terminalImageMessageAccepted', (event) => (
        event.kind === 'terminalImageMessageAccepted' && event.panelId === input.panelId
      ));
    } finally {
      this.active = null;
    }
  }

  private request<K extends Exclude<TerminalImageEvent['kind'], 'error'>>(
    command: MobileCommand & { requestId: string },
    expected: K,
    accept: (event: Extract<TerminalImageEvent, { kind: K }>) => boolean,
  ): Promise<Extract<TerminalImageEvent, { kind: K }>> {
    return new Promise((resolve, reject) => {
      const timer = this.schedule(() => {
        if (!this.pending.delete(command.requestId)) return;
        reject(this.active === 'committing'
          ? new TerminalImageCommitAmbiguousError('terminal image commit timed out')
          : new Error('terminal image transfer timed out'));
      }, this.timeoutMs);
      this.pending.set(command.requestId, {
        expected,
        accept: (event) => accept(event as Extract<TerminalImageEvent, { kind: K }>),
        resolve: (event) => resolve(event as Extract<TerminalImageEvent, { kind: K }>),
        reject,
        timer,
      });
      void this.options.send(command).catch((error: unknown) => {
        const pending = this.pending.get(command.requestId);
        if (pending === undefined) return;
        this.pending.delete(command.requestId);
        this.cancelSchedule(timer);
        pending.reject(this.active === 'committing'
          ? new TerminalImageCommitAmbiguousError('terminal image commit result is ambiguous')
          : error instanceof Error ? error : new Error('terminal image command failed'));
      });
    });
  }
}

function validateInput(text: string, image: PreparedRoomImage): void {
  if (
    text.length > 4_000
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)
    || image.bytes.byteLength < 1
    || image.bytes.byteLength > ROOM_IMAGE_MAX_BYTES
    || !/^[0-9a-f]{64}$/u.test(image.sha256)
    || (image.mime !== 'image/png' && image.mime !== 'image/jpeg')
  ) throw new Error('invalid terminal image message');
}
