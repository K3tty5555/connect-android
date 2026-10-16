import { useCallback, useMemo, useRef, useState } from 'react';
import {
  IDLE_OPERATION,
  advanceOperation,
  beginOperation,
  cancelOperation,
  type OperationPhase,
  type OperationSnapshot,
} from './operationPresentation';

export interface OperationStateController {
  snapshot: OperationSnapshot;
  begin(operationId: string): void;
  advance(
    operationId: string,
    phase: Exclude<OperationPhase, 'idle' | 'pending'>,
  ): boolean;
  cancel(operationId?: string): boolean;
  current(): OperationSnapshot;
}

export function useOperationState(): OperationStateController {
  const [snapshot, setSnapshot] = useState<OperationSnapshot>(IDLE_OPERATION);
  const currentRef = useRef<OperationSnapshot>(IDLE_OPERATION);
  const publish = useCallback((next: OperationSnapshot): boolean => {
    if (next === currentRef.current) return false;
    currentRef.current = next;
    setSnapshot(next);
    return true;
  }, []);
  const begin = useCallback((operationId: string): void => {
    publish(beginOperation(operationId));
  }, [publish]);
  const advance = useCallback((
    operationId: string,
    phase: Exclude<OperationPhase, 'idle' | 'pending'>,
  ): boolean => publish(advanceOperation(currentRef.current, operationId, phase)), [publish]);
  const cancel = useCallback((operationId?: string): boolean => (
    publish(cancelOperation(currentRef.current, operationId))
  ), [publish]);
  const current = useCallback((): OperationSnapshot => currentRef.current, []);
  return useMemo(() => ({ snapshot, begin, advance, cancel, current }), [
    advance,
    begin,
    cancel,
    current,
    snapshot,
  ]);
}
