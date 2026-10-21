import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '../domain/session';

/**
 * 从「在线」离开后，确认中 / 重连中在这个窗口内恢复就不显示。
 *
 * 原先只隐藏 700 ms 的同 socket 探活、重连一律立即显示。2026-10-20 用户拍板「切后台回来要无感」：
 * 回前台时换一条连接（短探活 1.5 s + 重拨）是常态，几秒内就恢复，闪一下「重连中」只会让人以为断了。
 * 窗口从离开在线算起、对探活和随后的重拨共用一个；超出窗口如实显示。断开、未配对仍立即显示。
 * 真实状态照旧交给指令门控，窗口内的输入不会被当成已送达。
 */
export const CONNECTION_NOTICE_DELAY_MS = 2_500;
export const CONNECTION_CONFIRMING_NOTICE_DELAY_MS = CONNECTION_NOTICE_DELAY_MS;

const HIDEABLE: ReadonlySet<ConnectionState> = new Set<ConnectionState>(['confirming', 'reconnecting']);

/**
 * Hides a brief liveness round trip or reconnect without hiding real outages.
 * The authoritative connection state remains available to command gating.
 */
export function usePresentedConnection(
  connection: ConnectionState,
  noticeDelayMs = CONNECTION_NOTICE_DELAY_MS,
): ConnectionState {
  const [presented, setPresented] = useState(connection);
  const presentedRef = useRef(presented);
  const leftOnlineAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (HIDEABLE.has(connection) && presentedRef.current === 'online') {
      leftOnlineAtRef.current ??= Date.now();
      const remaining = noticeDelayMs - (Date.now() - leftOnlineAtRef.current);
      if (remaining > 0) {
        const timer = setTimeout(() => {
          presentedRef.current = connection;
          setPresented(connection);
        }, remaining);
        return () => clearTimeout(timer);
      }
    }

    if (!HIDEABLE.has(connection)) leftOnlineAtRef.current = null;
    if (presentedRef.current !== connection) {
      presentedRef.current = connection;
      setPresented(connection);
    }
    return undefined;
  }, [noticeDelayMs, connection]);

  return presented;
}
