import { base64ToBytes, concatBytes } from '../net/bytes';

export const MOBILE_SNAPSHOT_FRAGMENT_BYTES = 256 * 1024;
export const MOBILE_SNAPSHOT_MAX_BYTES = 8 * 1024 * 1024;
export const MOBILE_SNAPSHOT_MAX_FRAGMENTS = 32;

export interface PtyReplayStartEvent {
  kind: 'ptyReplayStart';
  panelId: string;
  oldestSeq: number;
  upperSeq: number;
  droppedLines: number;
  omittedLines: number;
  snapshotSeq: number;
  cols: number;
  rows: number;
  snapshotBytes: number;
  fragmentCount: number;
}

export interface PtyReplayChunkEvent {
  kind: 'ptyReplayChunk';
  panelId: string;
  snapshotSeq: number;
  fragmentIndex: number;
  data: string;
}

export interface PtyReplayCommitEvent {
  kind: 'ptyReplayCommit';
  panelId: string;
  snapshotSeq: number;
  snapshotBytes: number;
  fragmentCount: number;
}

export type FragmentedPtyReplayEvent =
  | PtyReplayStartEvent
  | PtyReplayChunkEvent
  | PtyReplayCommitEvent;

export interface AssembledPtyReplayEvent {
  kind: 'ptyReplay';
  panelId: string;
  oldestSeq: number;
  upperSeq: number;
  droppedLines: number;
  omittedLines: number;
  snapshot: string;
  snapshotSeq: number;
  cols: number;
  rows: number;
}

interface PendingSnapshot {
  start: PtyReplayStartEvent;
  chunks: Uint8Array[];
  receivedBytes: number;
}

/** Fail-closed ordered assembly. No partial ANSI stream escapes before commit. */
export class TerminalSnapshotAssembler {
  private pending: PendingSnapshot | null = null;

  accept(event: FragmentedPtyReplayEvent): AssembledPtyReplayEvent | null {
    try {
      if (event.kind === 'ptyReplayStart') {
        if (this.pending !== null) throw new Error('PTY snapshot already in progress');
        this.pending = { start: event, chunks: [], receivedBytes: 0 };
        return null;
      }

      const pending = this.pending;
      if (pending === null) throw new Error('PTY snapshot fragment has no start');
      if (
        event.panelId !== pending.start.panelId
        || event.snapshotSeq !== pending.start.snapshotSeq
      ) throw new Error('PTY snapshot identity changed');

      if (event.kind === 'ptyReplayChunk') {
        if (event.fragmentIndex !== pending.chunks.length) {
          throw new Error('PTY snapshot fragment is out of order');
        }
        const bytes = base64ToBytes(event.data);
        if (bytes.byteLength < 1 || bytes.byteLength > MOBILE_SNAPSHOT_FRAGMENT_BYTES) {
          throw new Error('PTY snapshot fragment exceeds byte bound');
        }
        if (
          event.fragmentIndex < pending.start.fragmentCount - 1
          && bytes.byteLength !== MOBILE_SNAPSHOT_FRAGMENT_BYTES
        ) throw new Error('PTY snapshot fragment ended early');
        pending.receivedBytes += bytes.byteLength;
        if (pending.receivedBytes > pending.start.snapshotBytes) {
          throw new Error('PTY snapshot exceeds declared byte length');
        }
        pending.chunks.push(bytes);
        return null;
      }

      if (
        event.snapshotBytes !== pending.start.snapshotBytes
        || event.fragmentCount !== pending.start.fragmentCount
        || pending.chunks.length !== pending.start.fragmentCount
        || pending.receivedBytes !== pending.start.snapshotBytes
      ) throw new Error('PTY snapshot commit does not match fragments');

      const bytes = concatBytes(...pending.chunks);
      const snapshot = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const start = pending.start;
      this.pending = null;
      return {
        kind: 'ptyReplay',
        panelId: start.panelId,
        oldestSeq: start.oldestSeq,
        upperSeq: start.upperSeq,
        droppedLines: start.droppedLines,
        omittedLines: start.omittedLines,
        snapshot,
        snapshotSeq: start.snapshotSeq,
        cols: start.cols,
        rows: start.rows,
      };
    } catch (error) {
      this.pending = null;
      throw error;
    }
  }

  assertIdle(): void {
    if (this.pending !== null) {
      this.pending = null;
      throw new Error('PTY snapshot was interrupted before commit');
    }
  }

  abort(panelId: string): void {
    if (this.pending?.start.panelId === panelId) this.pending = null;
  }

  reset(): void {
    this.pending = null;
  }
}
