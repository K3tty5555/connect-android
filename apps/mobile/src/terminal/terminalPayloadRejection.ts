/** Re-syncs allowed for one panel before the renderer itself is suspect. */
export const MAX_PAYLOAD_REJECTIONS_PER_PANEL = 3;

export type TerminalPayloadRejectionAction = 'recover' | 'fallback' | 'block';

/**
 * Decides how hard to try after the desktop sends a frame this build cannot
 * render.
 *
 * Asking for a fresh full frame fixes the case where the phone's own cached
 * state is what made the frame unusable. When it keeps happening the frames
 * themselves are the problem, so the panel drops to the compatibility renderer
 * — the same fallback the desktop's own `terminal_grid_unavailable` uses. If
 * even that keeps failing, stop and say so rather than re-attaching forever.
 */
export class TerminalPayloadRejectionPolicy {
  private readonly limit: number;
  private readonly counts = new Map<string, number>();

  constructor(options: { limit?: number } = {}) {
    this.limit = options.limit ?? MAX_PAYLOAD_REJECTIONS_PER_PANEL;
  }

  record(panelId: string): TerminalPayloadRejectionAction {
    const count = (this.counts.get(panelId) ?? 0) + 1;
    this.counts.set(panelId, count);
    if (count < this.limit) return 'recover';
    if (count === this.limit) return 'fallback';
    return 'block';
  }

  /** A frame this panel could actually present ends the run. */
  clear(panelId: string): void {
    this.counts.delete(panelId);
  }

  reset(): void {
    this.counts.clear();
  }
}
