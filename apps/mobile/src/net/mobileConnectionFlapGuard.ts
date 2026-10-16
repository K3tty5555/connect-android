/** How long an authenticated session must last before it counts as healthy. */
export const CONNECTION_STABILITY_MS = 15_000;
/** Short-lived sessions inside the window before the phone stops dialling on its own. */
export const MAX_SHORT_LIVED_CONNECTIONS = 5;
/**
 * How long a short-lived session stays on the record. Without it the count only
 * ever went up: five drops spread across an afternoon tripped the breaker
 * exactly like five in ten seconds, which punishes the weak-link users — 5G
 * through a relay, moving between cell sites — that it was never aimed at.
 * Ten minutes is still far longer than a real storm needs to reach five.
 */
export const FLAP_WINDOW_MS = 600_000;
const STEADY_BACKOFF_CAP_MS = 5_000;
const FLAPPING_BACKOFF_CAP_MS = 30_000;

export type MobileConnectionLifetime = 'never_authenticated' | 'short_lived' | 'stable';

/**
 * Stops a connection that keeps dying seconds after it authenticates from
 * becoming an unbounded reconnect storm.
 *
 * The backoff used to be reset the moment a handshake succeeded, so any cause
 * that killed the session right afterwards produced one full connect cycle per
 * second — a real incident put 970 handshakes in the desktop audit log in a
 * single stretch. Resetting on a handshake measures the wrong thing: what makes
 * a connection healthy is lasting, not starting.
 *
 * A dial that never authenticates is an ordinary outage and is left to the
 * plain backoff; only sessions that got in and fell straight back out count
 * here, because those are the ones the backoff cannot see.
 */
export class MobileConnectionFlapGuard {
  private readonly stabilityMs: number;
  private readonly maxShortLived: number;
  private readonly windowMs: number;
  private authenticatedAtMs: number | null = null;
  /** Close times of the short-lived sessions still inside the window. */
  private shortLivedAtMs: number[] = [];

  constructor(options: {
    stabilityMs?: number;
    maxShortLived?: number;
    windowMs?: number;
  } = {}) {
    this.stabilityMs = options.stabilityMs ?? CONNECTION_STABILITY_MS;
    this.maxShortLived = options.maxShortLived ?? MAX_SHORT_LIVED_CONNECTIONS;
    this.windowMs = options.windowMs ?? FLAP_WINDOW_MS;
  }

  authenticated(atMs: number): void {
    this.authenticatedAtMs = atMs;
  }

  closed(atMs: number): MobileConnectionLifetime {
    const authenticatedAtMs = this.authenticatedAtMs;
    this.authenticatedAtMs = null;
    // Age the record on every close, including the ones this guard does not
    // judge — otherwise a long outage after a storm keeps the longer backoff
    // ceiling forever.
    const cutoff = atMs - this.windowMs;
    this.shortLivedAtMs = this.shortLivedAtMs.filter((closedAtMs) => closedAtMs > cutoff);
    if (authenticatedAtMs === null) return 'never_authenticated';
    if (atMs - authenticatedAtMs >= this.stabilityMs) {
      this.shortLivedAtMs = [];
      return 'stable';
    }
    this.shortLivedAtMs.push(atMs);
    return 'short_lived';
  }

  /** True once the phone should stop dialling and say so instead. */
  get tripped(): boolean {
    return this.shortLivedAtMs.length >= this.maxShortLived;
  }

  /**
   * Flapping earns a longer ceiling than a plain outage: a phone that cannot
   * hold a session gains nothing from asking again every five seconds, while an
   * unreachable desktop should still be picked up promptly when it returns.
   */
  backoffCapMs(): number {
    return this.shortLivedAtMs.length > 0 ? FLAPPING_BACKOFF_CAP_MS : STEADY_BACKOFF_CAP_MS;
  }

  /**
   * Drops the session without judging it. Backgrounding the app or a deliberate
   * disconnect ends a session for reasons that say nothing about whether the
   * connection was healthy, and counting them would trip the breaker on a user
   * who simply switches apps often.
   */
  forget(): void {
    this.authenticatedAtMs = null;
  }

  reset(): void {
    this.authenticatedAtMs = null;
    this.shortLivedAtMs = [];
  }
}
