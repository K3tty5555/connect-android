import { parseCrashLog, sanitizeCrashLogEntry } from '../../../../src/shared/crashReport';
import type { CrashLogEntry } from '../../../../src/shared/types';
import { textToBytes } from '../net/bytes';

export interface CrashLogStorePort {
  /** Bytes in the active file; 0 when it does not exist. */
  size(): number;
  /** Appends UTF-8 text to the active file synchronously, creating it if needed. */
  append(text: string): void;
  /** Replaces the single rotated file with the active one; the next append starts a new file. */
  rotate(): void;
  /** Rotated text, then active text; '' for a missing file. */
  read(): readonly [string, string];
}

/** One active file plus one rotated generation: about 128 KB on the phone in total. */
export const CRASH_LOG_MAX_FILE_BYTES = 64 * 1024;

/**
 * The phone's crash log (ADR-008), the same JSONL the desktop writes. Every line
 * is rebuilt from the contract's whitelist before it is written, so nothing the
 * contract does not name reaches the disk. A crash log must never become the
 * crash: every disk failure is swallowed.
 */
export class CrashLogStore {
  private readonly maxFileBytes: number;

  constructor(private readonly port: CrashLogStorePort, options: { maxFileBytes?: number } = {}) {
    this.maxFileBytes = options.maxFileBytes ?? CRASH_LOG_MAX_FILE_BYTES;
  }

  /** Returns whether the entry reached the disk. */
  record(value: unknown): boolean {
    try {
      const entry = sanitizeCrashLogEntry(value);
      if (entry === null) return false;
      const line = `${JSON.stringify(entry)}\n`;
      const bytes = textToBytes(line).length;
      if (bytes > this.maxFileBytes) return false;
      const size = this.port.size();
      if (size > 0 && size + bytes > this.maxFileBytes) {
        // A failed rotation must not swallow this entry and every later one.
        try { this.port.rotate(); } catch { /* append anyway */ }
      }
      this.port.append(line);
      return true;
    } catch {
      return false;
    }
  }

  /** Oldest first. */
  entries(): CrashLogEntry[] {
    try {
      const [rotated, active] = this.port.read();
      return parseCrashLog(rotated, active);
    } catch {
      return [];
    }
  }
}
