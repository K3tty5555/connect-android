import type {
  NativeTerminalGridState,
  TerminalGridApplyResult,
} from './terminalGridModel';

export interface TerminalGridFrameDisposition {
  /**
   * `complete` gives back the attach slot this panel holds because the frame
   * proves the attach landed; `release` gives it back without that claim;
   * `retain` keeps an in-flight recovery alive.
   */
  recovery: 'complete' | 'release' | 'retain';
  /** Ask the desktop for a fresh full frame before anything is presented. */
  recover: boolean;
  /** Authoritative state to hand to the presentation layer, or null. */
  present: NativeTerminalGridState | null;
}

/**
 * Decides what a delivered grid frame means for attach bookkeeping.
 *
 * A frame that only repeats what this phone already holds is not a failure: the
 * desktop mirror's revision advances on PTY output, so a finished conversation
 * replays the same revision on every re-attach. Treating that as "nothing
 * happened" used to leave the panel's attach slot claimed forever, and the next
 * visit skipped the attach entirely — the screen then kept showing whichever
 * panel was presented before it.
 */
export function terminalGridFrameDisposition(
  result: TerminalGridApplyResult,
  input: { activePanel: boolean; swapOperationId: string | null },
): TerminalGridFrameDisposition {
  if (result.kind === 'recovery_required') {
    return input.activePanel
      ? { recovery: 'retain', recover: true, present: null }
      : { recovery: 'release', recover: false, present: null };
  }
  const present = input.activePanel
    && (result.kind === 'applied' || input.swapOperationId !== null);
  return {
    recovery: 'complete',
    recover: false,
    present: present ? result.state : null,
  };
}
