import type { TerminalSwapSnapshot } from './terminalSwapCoordinator';

/** The frame is already in hand; only the view's own paint reply is outstanding. */
export const TERMINAL_PAINT_DEADLINE_MS = 3_000;
/**
 * Preparing is still waiting on the desktop, so it gets the slower bound: above
 * the 10 s catalog refresh and well past a 5G round trip, but not unbounded —
 * an attach rejection that arrives without a request id settles nothing, and the
 * switch indicator would spin for the rest of the session.
 */
export const TERMINAL_PREPARE_DEADLINE_MS = 15_000;

export interface TerminalPaintDeadlineOptions {
  onExpired(panelId: string, operationId: string): void;
  deadlineMs?: number;
  prepareDeadlineMs?: number;
  schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Bounds the wait for a terminal swap so the header cannot spin forever.
 *
 * Painting is a local render step, not a network wait: the authoritative frame
 * is already in hand and the view has one animation frame's worth of work left.
 * Preparing is still waiting on the desktop and gets the slower bound. Either
 * way, when the swap never settles it must be told it failed — the caller
 * freezes the old frame and leaves the retry open. Reporting it as painted
 * instead would claim the target is on screen and start routing its live output
 * into a view still showing the previous panel.
 */
export class TerminalPaintDeadline {
  private readonly onExpired: TerminalPaintDeadlineOptions['onExpired'];
  private readonly deadlineMs: number;
  private readonly prepareDeadlineMs: number;
  private readonly schedule: NonNullable<TerminalPaintDeadlineOptions['schedule']>;
  private readonly cancel: NonNullable<TerminalPaintDeadlineOptions['cancel']>;
  private armed: {
    operationId: string;
    phase: 'preparing' | 'painting';
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(options: TerminalPaintDeadlineOptions) {
    this.onExpired = options.onExpired;
    this.deadlineMs = options.deadlineMs ?? TERMINAL_PAINT_DEADLINE_MS;
    this.prepareDeadlineMs = options.prepareDeadlineMs ?? TERMINAL_PREPARE_DEADLINE_MS;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  }

  /**
   * Follows the swap: arms on the operation that is preparing or painting, and
   * clears on anything else. Re-arming the same operation in the same phase is a
   * no-op, so the stream of frames a live panel produces cannot keep pushing the
   * deadline out; crossing preparing → painting restarts it on the shorter bound.
   */
  sync(snapshot: TerminalSwapSnapshot): void {
    const { operationId, phase, targetPanelId } = snapshot;
    if (
      (phase !== 'painting' && phase !== 'preparing')
      || operationId === null
      || targetPanelId === null
    ) {
      this.clear();
      return;
    }
    if (this.armed?.operationId === operationId && this.armed.phase === phase) return;
    this.clear();
    this.armed = {
      operationId,
      phase,
      timer: this.schedule(() => {
        if (this.armed?.operationId !== operationId) return;
        this.armed = null;
        this.onExpired(targetPanelId, operationId);
      }, phase === 'painting' ? this.deadlineMs : this.prepareDeadlineMs),
    };
  }

  clear(): void {
    const armed = this.armed;
    if (armed === null) return;
    this.armed = null;
    this.cancel(armed.timer);
  }
}
