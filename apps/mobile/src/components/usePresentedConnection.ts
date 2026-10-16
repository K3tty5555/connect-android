import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '../domain/session';

export const CONNECTION_CONFIRMING_NOTICE_DELAY_MS = 700;

/**
 * Hides a routine same-socket liveness round trip without hiding real reconnects.
 * The authoritative connection state remains available to command gating.
 */
export function usePresentedConnection(
  connection: ConnectionState,
  confirmingDelayMs = CONNECTION_CONFIRMING_NOTICE_DELAY_MS,
): ConnectionState {
  const [presented, setPresented] = useState(connection);
  const presentedRef = useRef(presented);

  useEffect(() => {
    if (connection === 'confirming' && presentedRef.current === 'online') {
      const timer = setTimeout(() => {
        presentedRef.current = 'confirming';
        setPresented('confirming');
      }, confirmingDelayMs);
      return () => clearTimeout(timer);
    }

    if (presentedRef.current !== connection) {
      presentedRef.current = connection;
      setPresented(connection);
    }
    return undefined;
  }, [confirmingDelayMs, connection]);

  return presented;
}
