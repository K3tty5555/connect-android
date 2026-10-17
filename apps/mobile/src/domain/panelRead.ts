import type { MobilePanelStatus } from '../../../../src/shared/types';
import type { ConnectionState } from './session';

/**
 * Seeing a finished panel on the phone is seeing it on the desktop (user
 * decision 2026-10-17, MOBILE-SESSION-RUN-STATE-01): only the panel actually in
 * front of the user, in the foreground, and only a new result — never a
 * needs-input or error lamp, which stay until they are dealt with.
 */
export function shouldMarkPanelRead(input: {
  onSessionRoute: boolean;
  appActive: boolean;
  connection: ConnectionState;
  activePanelId: string | null;
  status: MobilePanelStatus | undefined;
  desktopSupportsPanelStates: boolean;
}): boolean {
  return input.onSessionRoute
    && input.appActive
    && input.connection === 'online'
    && input.activePanelId !== null
    && input.status === 'unread'
    && input.desktopSupportsPanelStates;
}
