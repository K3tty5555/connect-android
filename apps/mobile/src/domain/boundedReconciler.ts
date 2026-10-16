export type ScheduledTimer = ReturnType<typeof setTimeout>;

export interface BoundedReconcilerOptions {
  intervalMs: number;
  maxAttempts: number;
  initiallyDelayed: boolean;
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
}

export class GenerationGuard {
  private generation = 0;

  capture(): number {
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

/** Runs one callback at a time and never schedules work for an invalidated generation. */
export class BoundedReconciler {
  private readonly intervalMs: number;
  private readonly maxAttempts: number;
  private readonly initiallyDelayed: boolean;
  private readonly schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  private readonly cancel: (timer: ScheduledTimer) => void;
  private readonly generation = new GenerationGuard();
  private timer: ScheduledTimer | null = null;

  constructor(options: BoundedReconcilerOptions) {
    this.intervalMs = options.intervalMs;
    this.maxAttempts = options.maxAttempts;
    this.initiallyDelayed = options.initiallyDelayed;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  }

  start(attempt: () => void, onTimeout: () => void, initialDelayMs?: number): void {
    this.stop();
    const generation = this.generation.capture();
    let attempts = 0;
    const run = (): void => {
      if (!this.generation.isCurrent(generation)) return;
      this.timer = null;
      if (attempts >= this.maxAttempts) {
        onTimeout();
        return;
      }
      attempts += 1;
      attempt();
      if (!this.generation.isCurrent(generation)) return;
      this.timer = this.schedule(run, this.intervalMs);
    };
    if (this.initiallyDelayed) {
      this.timer = this.schedule(run, initialDelayMs ?? this.intervalMs);
    } else {
      run();
    }
  }

  stop(): void {
    this.generation.invalidate();
    if (this.timer === null) return;
    this.cancel(this.timer);
    this.timer = null;
  }
}
