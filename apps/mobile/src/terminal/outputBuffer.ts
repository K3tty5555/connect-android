export interface OutputDrop {
  chars: number;
  lines: number;
}

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

/** Bounded FIFO between React Native and the local terminal WebView. */
export class BoundedTerminalOutput {
  private readonly chunks: string[] = [];
  private chars = 0;

  constructor(private readonly maxChars: number) {
    if (!Number.isInteger(maxChars) || maxChars < 1) {
      throw new Error('invalid terminal output limit');
    }
  }

  enqueue(data: string): OutputDrop {
    if (data.length === 0) return { chars: 0, lines: 0 };
    this.chunks.push(data);
    this.chars += data.length;
    let droppedChars = 0;
    let droppedLines = 0;
    while (this.chars > this.maxChars) {
      const first = this.chunks[0];
      if (first === undefined) break;
      const overflow = this.chars - this.maxChars;
      const remove = safeSplitIndex(first, Math.min(first.length, overflow));
      const dropped = first.slice(0, remove);
      droppedChars += dropped.length;
      droppedLines += countNewlines(dropped);
      this.chars -= dropped.length;
      if (remove === first.length) this.chunks.shift();
      else this.chunks[0] = first.slice(remove);
    }
    return { chars: droppedChars, lines: droppedLines };
  }

  replace(data: string): OutputDrop {
    this.clear();
    return this.enqueue(data);
  }

  snapshot(): string {
    return this.chunks.join('');
  }

  clear(): void {
    this.chunks.length = 0;
    this.chars = 0;
  }

  drain(maxChars: number): string {
    if (!Number.isInteger(maxChars) || maxChars < 1) {
      throw new Error('invalid terminal output batch size');
    }
    if (this.chars === 0) return '';
    const batch: string[] = [];
    let remaining = maxChars;
    while (remaining > 0 && this.chunks.length > 0) {
      const first = this.chunks[0]!;
      const take = safeSplitIndex(first, Math.min(first.length, remaining));
      if (take === 0) break;
      batch.push(first.slice(0, take));
      this.chars -= take;
      remaining -= take;
      if (take === first.length) this.chunks.shift();
      else this.chunks[0] = first.slice(take);
    }
    return batch.join('');
  }

  get length(): number {
    return this.chars;
  }
}
