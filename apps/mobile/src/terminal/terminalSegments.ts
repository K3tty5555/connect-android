export interface TerminalGeometry {
  cols: number;
  rows: number;
}

export interface TerminalSegment {
  data: string;
  geometry?: TerminalGeometry;
}

export interface TerminalSegmentDrop {
  chars: number;
  lines: number;
}

const MAX_COALESCED_SEGMENT_CHARS = 64 * 1024;

function countNewlines(value: string): number {
  let lines = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

function safeSplitIndex(value: string, requested: number): number {
  if (requested <= 0) return 0;
  if (requested >= value.length) return value.length;
  const code = value.charCodeAt(requested);
  return code >= 0xdc00 && code <= 0xdfff ? requested + 1 : requested;
}

function sameGeometry(
  left: TerminalGeometry | undefined,
  right: TerminalGeometry | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.cols === right.cols && left.rows === right.rows;
}

function cloneSegment(segment: TerminalSegment): TerminalSegment {
  return {
    data: segment.data,
    ...(segment.geometry === undefined ? {} : { geometry: { ...segment.geometry } }),
  };
}

/** Bounded FIFO that preserves the PTY geometry associated with every byte range. */
export class BoundedTerminalSegments {
  private segments: TerminalSegment[] = [];
  private chars = 0;

  constructor(private readonly maxChars: number) {
    if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error('invalid segment buffer limit');
  }

  enqueue(data: string, geometry?: TerminalGeometry): TerminalSegmentDrop {
    if (data.length === 0) return { chars: 0, lines: 0 };
    let offset = 0;
    while (offset < data.length) {
      const last = this.segments.at(-1);
      const appendCapacity = last && sameGeometry(last.geometry, geometry)
        ? MAX_COALESCED_SEGMENT_CHARS - last.data.length
        : 0;
      const requested = Math.min(
        data.length,
        offset + (appendCapacity > 0 ? appendCapacity : MAX_COALESCED_SEGMENT_CHARS),
      );
      const end = safeSplitIndex(data, requested);
      const chunk = data.slice(offset, end);
      if (appendCapacity > 0) last!.data += chunk;
      else this.segments.push({
        data: chunk,
        ...(geometry === undefined ? {} : { geometry: { ...geometry } }),
      });
      offset = end;
    }
    this.chars += data.length;
    return this.trim();
  }

  replace(segments: readonly TerminalSegment[]): TerminalSegmentDrop {
    this.clear();
    let dropped = { chars: 0, lines: 0 };
    for (const segment of segments) {
      const next = this.enqueue(segment.data, segment.geometry);
      dropped = { chars: dropped.chars + next.chars, lines: dropped.lines + next.lines };
    }
    return dropped;
  }

  drain(maxChars: number): TerminalSegment[] {
    if (!Number.isInteger(maxChars) || maxChars < 1 || this.chars === 0) return [];
    const drained: TerminalSegment[] = [];
    let remaining = Math.min(maxChars, this.chars);
    while (remaining > 0 && this.segments.length > 0) {
      const first = this.segments[0]!;
      const take = safeSplitIndex(first.data, Math.min(first.data.length, remaining));
      if (take === 0) break;
      drained.push({
        data: first.data.slice(0, take),
        ...(first.geometry === undefined ? {} : { geometry: { ...first.geometry } }),
      });
      this.chars -= take;
      remaining -= take;
      if (take === first.data.length) this.segments.shift();
      else first.data = first.data.slice(take);
    }
    return drained;
  }

  snapshot(): TerminalSegment[] {
    return this.segments.map(cloneSegment);
  }

  clear(): void {
    this.segments = [];
    this.chars = 0;
  }

  get length(): number {
    return this.chars;
  }

  private trim(): TerminalSegmentDrop {
    let droppedChars = 0;
    let droppedLines = 0;
    while (this.chars > this.maxChars && this.segments.length > 0) {
      const first = this.segments[0]!;
      const overflow = this.chars - this.maxChars;
      const remove = safeSplitIndex(first.data, Math.min(first.data.length, overflow));
      const dropped = first.data.slice(0, remove);
      droppedChars += remove;
      droppedLines += countNewlines(dropped);
      this.chars -= remove;
      if (remove === first.data.length) this.segments.shift();
      else first.data = first.data.slice(remove);
    }
    return { chars: droppedChars, lines: droppedLines };
  }
}
