export const MOBILE_PERFORMANCE_OPERATIONS = [
  'connection',
  'app_start',
  'navigation',
  'workspace_switch',
  'terminal_switch',
  'surface_create',
  'surface_close',
  'ownership',
  'room_send',
  'provider_turn',
  'terminal_render',
  'file_tree',
  'sheet',
  'notification_read',
] as const;

export type MobilePerformanceOperation = typeof MOBILE_PERFORMANCE_OPERATIONS[number];

export const MOBILE_PERFORMANCE_STAGES = [
  'started',
  'local_feedback',
  'intent_committed',
  'socket_open',
  'authenticated',
  'catalog_ready',
  'routed',
  'request_sent',
  'server_received',
  'authorized',
  'transcript_committed',
  'renderer_confirmed',
  'accepted',
  'provider_dispatched',
  'provider_streaming',
  'provider_committed',
  'pty_emitted',
  'batch_queued',
  'socket_sent',
  'socket_received',
  'decrypted',
  'rn_dispatched',
  'webview_received',
  'vt_parsed',
  'frame_committed',
  'first_paint',
  'stable_frame',
  'pty_output',
  'webview_painted',
  'completed',
  'cancelled',
  'failed',
] as const;

export type MobilePerformanceStage = typeof MOBILE_PERFORMANCE_STAGES[number];
export type MobilePerformanceResult = 'ok' | 'retryable' | 'action_required' | 'permanent' | 'ambiguous';

export interface MobilePerformanceMark {
  operationId: string;
  operation: MobilePerformanceOperation;
  stage: MobilePerformanceStage;
  atMs: number;
  result?: MobilePerformanceResult;
}

export interface MobilePerformanceSummary {
  operation: MobilePerformanceOperation;
  samples: number;
  p50Ms: number;
  p95Ms: number;
}

const OPERATION_ID_RE = /^(?:(?:req|perf)_[A-Za-z0-9_-]{8,64}|operation-[A-Za-z0-9_-]{8,64})$/u;

export function projectMobilePerformanceMark(value: MobilePerformanceMark): MobilePerformanceMark {
  if (!OPERATION_ID_RE.test(value.operationId)) throw new Error('invalid performance operation id');
  if (!(MOBILE_PERFORMANCE_OPERATIONS as readonly string[]).includes(value.operation)) {
    throw new Error('invalid performance operation');
  }
  if (!(MOBILE_PERFORMANCE_STAGES as readonly string[]).includes(value.stage)) {
    throw new Error('invalid performance stage');
  }
  if (!Number.isFinite(value.atMs) || value.atMs < 0) throw new Error('invalid monotonic time');
  if (
    value.result !== undefined
    && !(['ok', 'retryable', 'action_required', 'permanent', 'ambiguous'] as const)
      .includes(value.result)
  ) throw new Error('invalid performance result');
  return {
    operationId: value.operationId,
    operation: value.operation,
    stage: value.stage,
    atMs: value.atMs,
    ...(value.result === undefined ? {} : { result: value.result }),
  };
}

/** Mobile runtime copy of the desktop trace contract; bounded and metadata-free. */
export class MobilePerformanceTrace {
  private readonly marks: MobilePerformanceMark[] = [];

  constructor(
    private readonly limit = 512,
    private readonly now: () => number = () => performance.now(),
    private readonly observer?: (mark: MobilePerformanceMark) => void,
  ) {
    if (!Number.isInteger(limit) || limit < 16 || limit > 4096) {
      throw new Error('invalid mobile performance trace limit');
    }
  }

  record(
    operationId: string,
    operation: MobilePerformanceOperation,
    stage: MobilePerformanceStage,
    result?: MobilePerformanceResult,
  ): void {
    this.recordAt(operationId, operation, stage, this.now(), result);
  }

  recordAt(
    operationId: string,
    operation: MobilePerformanceOperation,
    stage: MobilePerformanceStage,
    atMs: number,
    result?: MobilePerformanceResult,
  ): void {
    const mark = projectMobilePerformanceMark({
      operationId,
      operation,
      stage,
      atMs,
      ...(result === undefined ? {} : { result }),
    });
    this.marks.push(mark);
    if (this.marks.length > this.limit) this.marks.splice(0, this.marks.length - this.limit);
    try {
      this.observer?.({ ...mark });
    } catch {
      // Diagnostics must never change the operation being measured.
    }
  }

  snapshot(): MobilePerformanceMark[] {
    return this.marks.map((mark) => ({ ...mark }));
  }

  clear(): void {
    this.marks.length = 0;
  }
}

export function summarizeMobilePerformance(
  marks: readonly MobilePerformanceMark[],
  operation: MobilePerformanceOperation,
  startStage: MobilePerformanceStage = 'started',
  endStage: MobilePerformanceStage = 'completed',
): MobilePerformanceSummary {
  const starts = new Map<string, number>();
  const durations: number[] = [];
  for (const mark of marks) {
    if (mark.operation !== operation) continue;
    if (mark.stage === startStage) starts.set(mark.operationId, mark.atMs);
    if (mark.stage !== endStage) continue;
    const start = starts.get(mark.operationId);
    if (start !== undefined && mark.atMs >= start) durations.push(mark.atMs - start);
  }
  durations.sort((left, right) => left - right);
  return {
    operation,
    samples: durations.length,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.ceil(values.length * ratio) - 1);
  return Math.round((values[index] ?? 0) * 100) / 100;
}
