// Metro packages apps/mobile as an isolated runtime. Keep this projection exact
// with src/core/operationPresentation.ts; the equality test imports both policies.
export const OPERATION_PHASES = Object.freeze([
  'idle',
  'pending',
  'accepted',
  'streaming',
  'completed',
  'failed',
  'ambiguous',
] as const);

export type OperationPhase = (typeof OPERATION_PHASES)[number];

export interface OperationSnapshot {
  operationId: string | null;
  phase: OperationPhase;
}

export interface OperationPresentation {
  phase: OperationPhase;
  busy: boolean;
  showProgress: boolean;
  showAccepted: boolean;
  showCompleted: boolean;
  showFailure: boolean;
  showAmbiguous: boolean;
  canRetry: boolean;
}

export const IDLE_OPERATION: OperationSnapshot = Object.freeze({
  operationId: null,
  phase: 'idle',
});

const TRANSITIONS: Readonly<Record<OperationPhase, readonly OperationPhase[]>> = Object.freeze({
  idle: [],
  pending: ['accepted', 'streaming', 'completed', 'failed', 'ambiguous'],
  accepted: ['streaming', 'completed', 'failed', 'ambiguous'],
  streaming: ['completed', 'failed', 'ambiguous'],
  completed: [],
  failed: [],
  ambiguous: [],
});

export function beginOperation(operationId: string): OperationSnapshot {
  if (operationId.length === 0) throw new Error('operation id must not be empty');
  return Object.freeze({ operationId, phase: 'pending' });
}

export function advanceOperation(
  current: OperationSnapshot,
  operationId: string,
  phase: Exclude<OperationPhase, 'idle' | 'pending'>,
): OperationSnapshot {
  if (current.operationId !== operationId) return current;
  if (current.phase === phase) return current;
  if (!TRANSITIONS[current.phase].includes(phase)) return current;
  return Object.freeze({ operationId, phase });
}

export function cancelOperation(
  current: OperationSnapshot,
  operationId?: string,
): OperationSnapshot {
  if (operationId !== undefined && current.operationId !== operationId) return current;
  return IDLE_OPERATION;
}

export function operationPresentation(
  snapshot: OperationSnapshot | OperationPhase,
): OperationPresentation {
  const phase = typeof snapshot === 'string' ? snapshot : snapshot.phase;
  return {
    phase,
    busy: phase === 'pending' || phase === 'accepted' || phase === 'streaming',
    showProgress: phase === 'pending' || phase === 'streaming',
    showAccepted: phase === 'accepted',
    showCompleted: phase === 'completed',
    showFailure: phase === 'failed',
    showAmbiguous: phase === 'ambiguous',
    canRetry: phase === 'failed',
  };
}
