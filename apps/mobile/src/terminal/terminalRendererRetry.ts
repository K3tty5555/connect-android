/**
 * The 恢复 action can wait on the desktop no longer than a terminal switch does
 * (`TERMINAL_PREPARE_DEADLINE_MS`): well past a 5G round trip, but bounded.
 */
export const TERMINAL_RENDERER_RETRY_DEADLINE_MS = 15_000;

export interface TerminalRendererRetryOptions {
  /** The retry did not bring the native terminal back; land on compatibility again. */
  onGiveUp(panelId: string): void;
  deadlineMs?: number;
  schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Gives every 恢复 a conclusion.
 *
 * The retry used to end only on a painted native frame or a handful of specific
 * failures. Any other answer to its attach — `command_failed`, an unavailable
 * mirror — or a first frame that never came left the button spinning until the
 * app restarted (ANDROID-COMPAT-FALLBACK-STUCK-1023). Now it settles on the
 * first frame for its panel, on any rejection of its request (or of its panel),
 * or at the deadline; only a superseded or cancelled retry stays silent.
 */
export class TerminalRendererRetry {
  private readonly onGiveUp: TerminalRendererRetryOptions['onGiveUp'];
  private readonly deadlineMs: number;
  private readonly schedule: NonNullable<TerminalRendererRetryOptions['schedule']>;
  private readonly cancelTimer: NonNullable<TerminalRendererRetryOptions['cancel']>;
  private armed: {
    panelId: string;
    operationId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(options: TerminalRendererRetryOptions) {
    this.onGiveUp = options.onGiveUp;
    this.deadlineMs = options.deadlineMs ?? TERMINAL_RENDERER_RETRY_DEADLINE_MS;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimer = options.cancel ?? ((timer) => clearTimeout(timer));
  }

  /** Arms on the attach the retry just sent, replacing any earlier one. */
  begin(panelId: string, operationId: string): void {
    this.cancel();
    const timer = this.schedule(() => {
      if (this.armed?.operationId !== operationId) return;
      this.armed = null;
      this.onGiveUp(panelId);
    }, this.deadlineMs);
    this.armed = { panelId, operationId, timer };
  }

  pendingPanelId(): string | null {
    return this.armed?.panelId ?? null;
  }

  /** A native frame reached the screen; true when it ended the pending retry. */
  painted(panelId: string): boolean {
    if (this.armed?.panelId !== panelId) return false;
    this.cancel();
    return true;
  }

  /**
   * The desktop refused something. It ends the retry when it names the retry's
   * request, or — for answers that carry no request id — its panel.
   */
  rejected(event: { requestId?: string; panelId?: string }): boolean {
    const armed = this.armed;
    if (armed === null) return false;
    const matches = event.requestId !== undefined
      ? event.requestId === armed.operationId
      : event.panelId === armed.panelId;
    if (!matches) return false;
    this.cancel();
    this.onGiveUp(armed.panelId);
    return true;
  }

  cancel(): void {
    if (this.armed === null) return;
    this.cancelTimer(this.armed.timer);
    this.armed = null;
  }
}
