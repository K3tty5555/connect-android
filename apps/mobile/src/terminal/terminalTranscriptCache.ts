import {
  BoundedTerminalSegments,
  type TerminalGeometry,
  type TerminalSegment,
} from './terminalSegments';

export interface TerminalTranscriptSnapshot {
  data: string;
  segments: TerminalSegment[];
  trimmedLines: number;
  lostLines: number;
  partialLoss: boolean;
}

interface TranscriptEntry {
  output: BoundedTerminalSegments;
  valid: boolean;
  trimmedLines: number;
  lostLines: number;
  partialLoss: boolean;
  exited: boolean;
}

/** Bounded LRU of raw ANSI streams, used to restore a visited panel without remounting xterm. */
export class TerminalTranscriptCache {
  private readonly panels = new Map<string, TranscriptEntry>();

  constructor(
    private readonly maxPanels = 8,
    private readonly maxCharsPerPanel = 1024 * 1024,
  ) {
    if (!Number.isInteger(maxPanels) || maxPanels < 1) throw new Error('invalid panel cache limit');
    if (!Number.isInteger(maxCharsPerPanel) || maxCharsPerPanel < 1) {
      throw new Error('invalid transcript cache limit');
    }
  }

  append(panelId: string, data: string, geometry?: TerminalGeometry): boolean {
    const entry = this.entry(panelId);
    if (!entry.valid) return false;
    this.appendToEntry(entry, data, geometry);
    this.touch(panelId, entry);
    return entry.valid;
  }

  replaceSnapshot(
    panelId: string,
    data: string,
    geometry: TerminalGeometry,
    trimmedLines = 0,
  ): boolean {
    return this.replaceSnapshotSegments(panelId, [{ data, geometry }], trimmedLines);
  }

  replaceSnapshotSegments(
    panelId: string,
    segments: readonly TerminalSegment[],
    trimmedLines = 0,
  ): boolean {
    const entry = this.entry(panelId);
    const dropped = entry.output.replace(segments);
    entry.valid = dropped.chars === 0;
    entry.trimmedLines = trimmedLines;
    entry.lostLines = 0;
    entry.partialLoss = false;
    entry.exited = false;
    this.touch(panelId, entry);
    return entry.valid;
  }

  invalidate(panelId: string): void {
    const entry = this.entry(panelId);
    entry.output.clear();
    entry.valid = false;
    this.touch(panelId, entry);
  }

  appendExit(panelId: string, marker: string): boolean {
    const entry = this.entry(panelId);
    if (entry.exited) return false;
    entry.exited = true;
    if (entry.valid) this.appendToEntry(entry, marker);
    this.touch(panelId, entry);
    return true;
  }

  reportLoss(panelId: string, lines: number): void {
    if (lines < 0 || !Number.isSafeInteger(lines)) return;
    const entry = this.entry(panelId);
    if (lines > 0) entry.lostLines += lines;
    else entry.partialLoss = true;
    this.touch(panelId, entry);
  }

  reportTrimmed(panelId: string, lines: number): void {
    if (lines <= 0 || !Number.isSafeInteger(lines)) return;
    const entry = this.entry(panelId);
    entry.trimmedLines += lines;
    this.touch(panelId, entry);
  }

  snapshot(panelId: string): TerminalTranscriptSnapshot | null {
    const entry = this.panels.get(panelId);
    if (!entry || !entry.valid) return null;
    this.touch(panelId, entry);
    const segments = entry.output.snapshot();
    return {
      data: segments.map((segment) => segment.data).join(''),
      segments,
      trimmedLines: entry.trimmedLines,
      lostLines: entry.lostLines,
      partialLoss: entry.partialLoss,
    };
  }

  clear(): void {
    this.panels.clear();
  }

  remove(panelId: string): void {
    this.panels.delete(panelId);
  }

  private entry(panelId: string): TranscriptEntry {
    const existing = this.panels.get(panelId);
    if (existing) return existing;
    while (this.panels.size >= this.maxPanels) {
      const oldest = this.panels.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.panels.delete(oldest);
    }
    const created = {
      output: new BoundedTerminalSegments(this.maxCharsPerPanel),
      valid: true,
      trimmedLines: 0,
      lostLines: 0,
      partialLoss: false,
      exited: false,
    };
    this.panels.set(panelId, created);
    return created;
  }

  private touch(panelId: string, entry: TranscriptEntry): void {
    this.panels.delete(panelId);
    this.panels.set(panelId, entry);
  }

  private appendToEntry(
    entry: TranscriptEntry,
    data: string,
    geometry?: TerminalGeometry,
  ): void {
    const dropped = entry.output.enqueue(data, geometry);
    if (dropped.chars > 0) {
      entry.output.clear();
      entry.valid = false;
    }
  }
}
