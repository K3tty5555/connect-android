import type { ScheduledTimer } from './boundedReconciler';

interface PendingOwnershipConfirmation {
  requestId: string;
  panelId: string;
}

interface OwnershipConfirmationTimersOptions {
  schedule?: (callback: () => void, delayMs: number) => ScheduledTimer;
  cancel?: (timer: ScheduledTimer) => void;
}

interface OwnershipConfirmationStartOptions {
  hedgeDelayMs: number;
  timeoutMs: number;
  onHedge: () => void;
  onTimeout: () => void;
}

const RECOVERABLE_OWNERSHIP_ERRORS = new Set([
  '控制权确认超时，请检查连接后重试。',
  '控制权结果未能确认，请连接后核对当前状态。',
  '控制权状态未能确认，请刷新后重试。',
  '控制权状态刷新失败，请检查连接。',
  '控制权请求未能确认，请检查连接。',
  '新终端控制权请求未能确认，请检查连接。',
  '控制权已变化，请按当前状态重新操作。',
]);

export function ownershipReplyMatches(
  pending: PendingOwnershipConfirmation | null,
  eventRequestId: string | undefined,
  eventPanelId: string,
): boolean {
  return pending !== null
    && eventRequestId === pending.requestId
    && eventPanelId === pending.panelId;
}

export function isRecoverableOwnershipError(detail: string | null): boolean {
  return detail !== null && RECOVERABLE_OWNERSHIP_ERRORS.has(detail);
}

/** Owns the early read-only reconciliation and the final ambiguous timeout. */
export class OwnershipConfirmationTimers {
  private readonly schedule: (callback: () => void, delayMs: number) => ScheduledTimer;
  private readonly cancel: (timer: ScheduledTimer) => void;
  private generation = 0;
  private hedgeTimer: ScheduledTimer | null = null;
  private timeoutTimer: ScheduledTimer | null = null;

  constructor(options: OwnershipConfirmationTimersOptions = {}) {
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  }

  start(options: OwnershipConfirmationStartOptions): void {
    this.stop();
    const generation = this.generation;
    this.hedgeTimer = this.schedule(() => {
      if (generation !== this.generation) return;
      this.hedgeTimer = null;
      options.onHedge();
    }, options.hedgeDelayMs);
    this.timeoutTimer = this.schedule(() => {
      if (generation !== this.generation) return;
      this.timeoutTimer = null;
      options.onTimeout();
    }, options.timeoutMs);
  }

  stop(): void {
    this.generation += 1;
    if (this.hedgeTimer !== null) {
      this.cancel(this.hedgeTimer);
      this.hedgeTimer = null;
    }
    if (this.timeoutTimer !== null) {
      this.cancel(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}
