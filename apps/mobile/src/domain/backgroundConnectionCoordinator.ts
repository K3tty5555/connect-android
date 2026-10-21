/**
 * How long a phone may keep its session — and the takeover it left behind —
 * while the app is off screen.
 *
 * iOS freezes JS well before this fires, so in practice the desktop's heartbeat
 * window is what actually bounds a phone that never comes back; this is sized
 * to sit under it. A short errand should return to the same session in the same
 * ownership state, and the desktop can always take the panel back explicitly.
 */
export const BACKGROUND_CONNECTION_GRACE_MS = 180_000;

export function shouldBackgroundMobileConnection(state: string): boolean {
  return state !== 'active';
}

interface BackgroundConnectionBridge {
  suspend(): void;
  /**
   * The bridge decides what coming back means — reviving a suspended socket,
   * probing one that only claims to be alive, or pre-empting a frozen backoff.
   * Bookkeeping kept out here could only ever be a guess about its state.
   */
  foreground(backgroundMs?: number): void;
}

export interface BackgroundConnectionCoordinatorOptions {
  bridge: BackgroundConnectionBridge;
  graceMs?: number;
  now?: () => number;
  schedule?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** Keeps short app switches seamless while bounding stale mobile ownership. */
export class BackgroundConnectionCoordinator {
  private readonly bridge: BackgroundConnectionBridge;
  private readonly graceMs: number;
  private readonly now: () => number;
  private readonly schedule: NonNullable<BackgroundConnectionCoordinatorOptions['schedule']>;
  private readonly cancel: NonNullable<BackgroundConnectionCoordinatorOptions['cancel']>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;
  private backgroundedAt: number | null = null;
  private generation = 0;
  private backgrounded = false;
  private suspendedForBackground = false;
  private released = false;

  constructor(options: BackgroundConnectionCoordinatorOptions) {
    this.bridge = options.bridge;
    this.graceMs = options.graceMs ?? BACKGROUND_CONNECTION_GRACE_MS;
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? setTimeout;
    this.cancel = options.cancel ?? clearTimeout;
  }

  background(): void {
    if (this.released || this.backgrounded) return;
    this.backgrounded = true;
    this.backgroundedAt = this.now();
    this.deadline = this.backgroundedAt + this.graceMs;
    const generation = ++this.generation;
    this.timer = this.schedule(() => {
      if (
        this.released
        || !this.backgrounded
        || generation !== this.generation
      ) return;
      this.timer = null;
      this.deadline = null;
      this.suspendedForBackground = true;
      this.bridge.suspend();
    }, this.graceMs);
  }

  foreground(): void {
    if (this.released) return;
    const deadlineExpired = (
      this.backgrounded
      && this.deadline !== null
      && this.now() >= this.deadline
    );
    // 离开了多久交给桥：长后台回来 socket 多半已被 iOS 掐断，桥据此用短探活（2026-10-20）。
    const backgroundMs = this.backgrounded && this.backgroundedAt !== null
      ? this.now() - this.backgroundedAt
      : undefined;
    this.backgroundedAt = null;
    this.backgrounded = false;
    this.deadline = null;
    this.generation += 1;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (deadlineExpired && !this.suspendedForBackground) {
      this.suspendedForBackground = true;
      this.bridge.suspend();
    }
    this.bridge.foreground(backgroundMs);
    this.suspendedForBackground = false;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.backgrounded = false;
    this.backgroundedAt = null;
    this.deadline = null;
    this.generation += 1;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }
}
