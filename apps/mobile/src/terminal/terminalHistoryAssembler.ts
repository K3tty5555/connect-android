import { base64ToBytes, concatBytes } from '../net/bytes';
import {
  BoundedTerminalSegments,
  type TerminalGeometry,
  type TerminalSegment,
} from './terminalSegments';

export const MOBILE_HISTORY_FRAGMENT_BYTES = 1024;
export const MOBILE_HISTORY_MAX_BYTES = 8 * 1024 * 1024;
export const MOBILE_HISTORY_MAX_FRAGMENTS = 8192;
const MOBILE_HISTORY_LIVE_MAX_CHARS = 1024 * 1024;

export interface PtyHistoryStartEvent {
  kind: 'ptyHistoryStart';
  panelId: string;
  snapshotSeq: number;
  omittedLines: number;
  cols: number;
  rows: number;
  snapshotBytes: number;
  fragmentCount: number;
}

export interface PtyHistoryChunkEvent {
  kind: 'ptyHistoryChunk';
  panelId: string;
  snapshotSeq: number;
  fragmentIndex: number;
  data: string;
}

export interface PtyHistoryCommitEvent {
  kind: 'ptyHistoryCommit';
  panelId: string;
  snapshotSeq: number;
  snapshotBytes: number;
  fragmentCount: number;
}

export type PtyHistoryEvent =
  | PtyHistoryStartEvent
  | PtyHistoryChunkEvent
  | PtyHistoryCommitEvent;

export interface AssembledPtyHistory {
  panelId: string;
  snapshotSeq: number;
  upperSeq: number;
  omittedLines: number;
  segments: TerminalSegment[];
}

interface PendingHistory {
  start: PtyHistoryStartEvent;
  chunks: Uint8Array[];
  receivedBytes: number;
  live: BoundedTerminalSegments;
  upperSeq: number;
}

/** Optional history enrichment: malformed/incomplete state is discarded, never presented. */
export class TerminalHistoryAssembler {
  private pending: PendingHistory | null = null;

  accept(event: PtyHistoryEvent): AssembledPtyHistory | null {
    if (event.kind === 'ptyHistoryStart') {
      this.pending = {
        start: event,
        chunks: [],
        receivedBytes: 0,
        live: new BoundedTerminalSegments(MOBILE_HISTORY_LIVE_MAX_CHARS),
        upperSeq: event.snapshotSeq,
      };
      return null;
    }
    const pending = this.pending;
    if (
      pending === null
      || event.panelId !== pending.start.panelId
      || event.snapshotSeq !== pending.start.snapshotSeq
    ) {
      this.pending = null;
      return null;
    }
    if (event.kind === 'ptyHistoryChunk') {
      if (event.fragmentIndex !== pending.chunks.length) {
        this.pending = null;
        return null;
      }
      const bytes = base64ToBytes(event.data);
      if (
        bytes.byteLength < 1
        || bytes.byteLength > MOBILE_HISTORY_FRAGMENT_BYTES
        || (
          event.fragmentIndex < pending.start.fragmentCount - 1
          && bytes.byteLength !== MOBILE_HISTORY_FRAGMENT_BYTES
        )
      ) {
        this.pending = null;
        return null;
      }
      pending.receivedBytes += bytes.byteLength;
      if (pending.receivedBytes > pending.start.snapshotBytes) {
        this.pending = null;
        return null;
      }
      pending.chunks.push(bytes);
      return null;
    }
    if (
      event.snapshotBytes !== pending.start.snapshotBytes
      || event.fragmentCount !== pending.start.fragmentCount
      || pending.chunks.length !== pending.start.fragmentCount
      || pending.receivedBytes !== pending.start.snapshotBytes
    ) {
      this.pending = null;
      return null;
    }
    try {
      const snapshot = new TextDecoder('utf-8', { fatal: true }).decode(
        concatBytes(...pending.chunks),
      );
      const start = pending.start;
      const live = pending.live.snapshot();
      this.pending = null;
      return {
        panelId: start.panelId,
        snapshotSeq: start.snapshotSeq,
        upperSeq: pending.upperSeq,
        omittedLines: start.omittedLines,
        segments: [
          { data: snapshot, geometry: { cols: start.cols, rows: start.rows } },
          ...live,
        ],
      };
    } catch {
      this.pending = null;
      return null;
    }
  }

  acceptLive(event: {
    id: string;
    seq: number;
    upperSeq?: number;
    data: string;
    cols?: number;
    rows?: number;
  }): void {
    const pending = this.pending;
    if (pending === null || event.id !== pending.start.panelId) return;
    if ((event.upperSeq ?? event.seq) <= pending.start.snapshotSeq) return;
    const geometry: TerminalGeometry | undefined = event.cols === undefined || event.rows === undefined
      ? undefined
      : { cols: event.cols, rows: event.rows };
    if (
      geometry !== undefined
      && (geometry.cols !== pending.start.cols || geometry.rows !== pending.start.rows)
    ) {
      this.pending = null;
      return;
    }
    pending.upperSeq = Math.max(pending.upperSeq, event.upperSeq ?? event.seq);
    if (pending.live.enqueue(event.data, geometry).chars > 0) this.pending = null;
  }

  abort(panelId: string): void {
    if (this.pending?.start.panelId === panelId) this.pending = null;
  }

  reset(): void {
    this.pending = null;
  }
}
