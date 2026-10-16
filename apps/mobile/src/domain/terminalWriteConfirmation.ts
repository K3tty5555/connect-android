export interface TerminalWriteConfirmationOptions {
  timeoutMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Tracks one correlated PTY write until the authoritative Mac accepts or rejects it. */
export class TerminalWriteConfirmation {
  private readonly timeoutMs: number;
  private readonly schedule: NonNullable<TerminalWriteConfirmationOptions['schedule']>;
  private readonly cancel: NonNullable<TerminalWriteConfirmationOptions['cancel']>;
  private pending: {
    requestId: string;
    panelId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(options: TerminalWriteConfirmationOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.schedule = options.schedule ?? setTimeout;
    this.cancel = options.cancel ?? clearTimeout;
  }

  begin(requestId: string, panelId: string, onTimeout: () => void): boolean {
    if (this.pending !== null) return false;
    const pending = {
      requestId,
      panelId,
      timer: this.schedule(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        onTimeout();
      }, this.timeoutMs),
    };
    this.pending = pending;
    return true;
  }

  accept(requestId: string, panelId: string): boolean {
    if (
      this.pending?.requestId !== requestId
      || this.pending.panelId !== panelId
    ) return false;
    this.clearPending();
    return true;
  }

  reject(requestId: string): boolean {
    if (this.pending?.requestId !== requestId) return false;
    this.clearPending();
    return true;
  }

  release(): boolean {
    if (this.pending === null) return false;
    this.clearPending();
    return true;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  private clearPending(): void {
    if (this.pending === null) return;
    this.cancel(this.pending.timer);
    this.pending = null;
  }
}
