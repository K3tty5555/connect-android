import type { ConnectionState, OwnershipState } from '../domain/session';

/**
 * Opening a terminal without a visible change of shape (MOBILE-NATIVE-RENDERER-ONLY-01).
 *
 * The desktop's first frames carry its own width; the native view fits them by
 * shrinking the font, and once the phone takes over and reshapes the PTY the
 * font jumps back. Users read that as the terminal misbehaving, not loading
 * (user decision 2026-10-17): while the phone's shape is still coming, the
 * desktop-width frames stay hidden behind the last screen or a loading state.
 * The wait is bounded so a takeover that never lands cannot stall the view.
 */
export const TERMINAL_OPENING_SETTLE_MS = 2_000;

export interface OpeningGeometryInput {
  connection: ConnectionState;
  isTerminal: boolean;
  isDemo: boolean;
  /** The compatibility byte stream: its shape is not negotiated on open. */
  byteStream: boolean;
  ownership: OwnershipState;
  /** False until this connection has an ownership answer for the panel. */
  ownershipKnown: boolean;
  canControlInput: boolean;
  followsPhone: boolean;
  autoTakeover: boolean;
}

/** Whether frames at the phone's own width are on their way for this opening. */
export function expectsPhoneGeometry(input: OpeningGeometryInput): boolean {
  if (input.connection !== 'online' || !input.isTerminal || input.isDemo || input.byteStream) return false;
  if (!input.canControlInput || !input.followsPhone) return false;
  if (!input.ownershipKnown) return true;
  switch (input.ownership) {
    case 'mobile_owned':
    case 'takeover_pending':
    case 'reconciling':
      return true;
    case 'desktop_owned':
      return input.autoTakeover;
    default:
      return false;
  }
}

export function terminalOpeningSettled(input: {
  expectsPhoneGeometry: boolean;
  /** Columns the native view fits at the reading size; null until measured. */
  phoneCols: number | null;
  frameCols: number;
  /** Measured from the first live frame of this opening. */
  sinceFirstFrameMs: number;
}): boolean {
  if (!input.expectsPhoneGeometry) return true;
  if (input.sinceFirstFrameMs >= TERMINAL_OPENING_SETTLE_MS) return true;
  return input.phoneCols !== null && input.frameCols === input.phoneCols;
}
