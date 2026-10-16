import { BoundedReconciler, type ScheduledTimer } from './boundedReconciler';

export interface CreatedTerminalReconcilerOptions {
  intervalMs?: number;
  maxAttempts?: number;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
}

export type NewSurfaceMatch =
  | { kind: 'pending' }
  | { kind: 'matched'; id: string }
  | { kind: 'ambiguous' };

export function matchUniqueNewSurface(
  existingIds: ReadonlySet<string>,
  candidateIds: readonly string[],
): NewSurfaceMatch {
  const newIds = [...new Set(candidateIds)].filter((id) => !existingIds.has(id));
  if (newIds.length === 0) return { kind: 'pending' };
  if (newIds.length === 1) return { kind: 'matched', id: newIds[0]! };
  return { kind: 'ambiguous' };
}

/** The renderer ACKs an exact mounted runtime; catalogs can still arrive later. */
export class CreatedTerminalReconciler {
  private readonly reconciler: BoundedReconciler;

  constructor(options: CreatedTerminalReconcilerOptions = {}) {
    this.reconciler = new BoundedReconciler({
      intervalMs: options.intervalMs ?? 500,
      maxAttempts: options.maxAttempts ?? 20,
      initiallyDelayed: true,
      schedule: options.schedule,
      cancel: options.cancel,
    });
  }

  start(refresh: () => void, onTimeout: () => void): void {
    this.reconciler.start(refresh, onTimeout);
  }

  stop(): void {
    this.reconciler.stop();
  }
}
