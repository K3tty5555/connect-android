import { BoundedReconciler, type ScheduledTimer } from './boundedReconciler';

export interface OwnershipReconcilerOptions {
  intervalMs?: number;
  maxAttempts?: number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
}

export function ownershipReconcileDelayMs(roundTripMs: number | null): number {
  if (roundTripMs === null || !Number.isFinite(roundTripMs) || roundTripMs <= 0) return 500;
  return Math.max(350, Math.min(1_500, Math.round(roundTripMs * 1.5)));
}

/** Re-requests authoritative ownership without ever inferring or changing it locally. */
export class OwnershipReconciler {
  private readonly reconciler: BoundedReconciler;

  constructor(options: OwnershipReconcilerOptions = {}) {
    this.reconciler = new BoundedReconciler({
      intervalMs: options.intervalMs ?? 1_000,
      maxAttempts: options.maxAttempts ?? 3,
      initiallyDelayed: true,
      schedule: options.schedule,
      cancel: options.cancel,
    });
  }

  start(probe: () => void, onTimeout: () => void, delayMs = 500): void {
    this.reconciler.start(probe, onTimeout, delayMs);
  }

  stop(): void {
    this.reconciler.stop();
  }
}
