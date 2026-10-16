import { textToBytes } from '../net/bytes';
import {
  projectMobilePerformanceMark,
  type MobilePerformanceMark,
} from './mobilePerformanceTrace';

export interface MobilePerformanceStorePort {
  /** Bytes currently in the active file; 0 when it does not exist. */
  size(): number;
  /** Appends UTF-8 text to the active file, creating it if needed. */
  append(text: string): void;
  /** Replaces the single history file with the active one and starts an empty one. */
  rotate(): void;
}

interface MobilePerformanceStoreOptions {
  runtimeId: string;
  wallNow?: () => number;
  /** Ceiling on lines held between flushes, not on the file. */
  limit?: number;
  maxFileBytes?: number;
  flushDelayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
}

interface PersistedMobilePerformanceMark extends MobilePerformanceMark {
  version: 1;
  runtimeId: string;
  recordedAtMs: number;
}

const RUNTIME_ID_RE = /^runtime[-_][A-Za-z0-9_-]{8,64}$/u;
/** Matches the desktop log's bound, so both sides of an operation age alike. */
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Bounded local timing log. Like the desktop's `MobilePerformanceLog` it appends
 * JSONL and keeps one rotated file: the store used to hold everything in one
 * in-process array and overwrite the whole file on each flush, with a fresh
 * `runtimeId` per App mount, so restarting the App destroyed the previous run —
 * and users normally restart several times before reporting anything.
 *
 * Writes are still coalesced, because measurement must not dominate the
 * interaction it is measuring.
 */
export class MobilePerformanceStore {
  private readonly pending: PersistedMobilePerformanceMark[] = [];
  private readonly wallNow: () => number;
  private readonly limit: number;
  private readonly maxFileBytes: number;
  private readonly flushDelayMs: number;
  private readonly schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly port: MobilePerformanceStorePort,
    private readonly options: MobilePerformanceStoreOptions,
  ) {
    if (!RUNTIME_ID_RE.test(options.runtimeId)) throw new Error('invalid performance runtime id');
    this.wallNow = options.wallNow ?? Date.now;
    this.limit = options.limit ?? 1_024;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    this.flushDelayMs = options.flushDelayMs ?? 250;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 4_096) {
      throw new Error('invalid performance store limit');
    }
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < 512) {
      throw new Error('invalid performance log size limit');
    }
  }

  record(value: MobilePerformanceMark): void {
    const recordedAtMs = this.wallNow();
    if (!Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0) {
      throw new Error('invalid performance wall timestamp');
    }
    this.pending.push({
      version: 1,
      runtimeId: this.options.runtimeId,
      recordedAtMs,
      ...projectMobilePerformanceMark(value),
    });
    if (this.pending.length > this.limit) {
      this.pending.splice(0, this.pending.length - this.limit);
    }
    if (this.timer !== null) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      try {
        this.flush();
      } catch {
        // Diagnostics are best effort and never change the measured operation.
      }
    }, this.flushDelayMs);
  }

  flush(): void {
    const batch = this.pending.splice(0, this.pending.length);
    if (batch.length === 0) return;
    let held = this.port.size();
    let chunk = '';
    let chunkBytes = 0;
    const emit = (): void => {
      if (chunk === '') return;
      this.port.append(chunk);
      held += chunkBytes;
      chunk = '';
      chunkBytes = 0;
    };
    for (const entry of batch) {
      const line = `${JSON.stringify(entry)}\n`;
      const lineBytes = textToBytes(line).length;
      // A line that cannot fit even an empty file is a bug in the mark, not
      // something to grow the file for. Drop it rather than break the bound.
      if (lineBytes > this.maxFileBytes) continue;
      if (held + chunkBytes + lineBytes > this.maxFileBytes) {
        emit();
        this.port.rotate();
        held = 0;
      }
      chunk += line;
      chunkBytes += lineBytes;
    }
    emit();
  }
}
