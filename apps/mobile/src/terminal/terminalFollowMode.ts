/**
 * Scroll ownership for the native terminal list.
 *
 * The list auto-follows the newest row, but the user must be able to take the
 * anchor away by dragging. Two rules keep that honest:
 *
 * 1. A running gesture (finger down or momentum) always owns the anchor. No
 *    content-size or layout pass may scroll the list while it runs — an
 *    unmeasured cell being measured mid-drag must not yank the user back down.
 * 2. Following only resumes when the list *rests* at the newest row. Passing
 *    through the bottom slack on the first pixels of an upward drag is not a
 *    request to keep following.
 * 3. Resting at the newest row only counts when the **list moved there**, not
 *    when the newest row came to the list. `atLatest` is derived from
 *    `contentHeight - offsetY - viewportHeight`, so it flips true on its own
 *    whenever content shrinks or the viewport grows — an alternate-screen app
 *    redrawing, the history window sliding, or the keyboard being dismissed,
 *    all while the finger is nowhere near the screen. Promoting on that is the
 *    「偶现自动滚动到底部」users reported: the list silently re-arms and the next
 *    output yanks them to the bottom. So promotion additionally requires the
 *    offset to have **increased**. A shrink that clamps the offset moves it
 *    *down*, and a taller viewport does not move it at all, so neither passes.
 */

export const TERMINAL_LATEST_SLACK_PX = 40;

export type TerminalScrollMode = 'following' | 'browsing' | 'returning';
export type TerminalScrollGesture = 'idle' | 'dragging' | 'momentum';

export interface TerminalFollowState {
  readonly mode: TerminalScrollMode;
  readonly gesture: TerminalScrollGesture;
  readonly atLatest: boolean;
  /** Last observed scroll offset, used to tell a real move from a content shift. */
  readonly offsetY: number;
}

export type TerminalFollowEvent =
  | { kind: 'reset' }
  | { kind: 'dragBegin' }
  | { kind: 'dragEnd' }
  | { kind: 'momentumBegin' }
  | { kind: 'momentumEnd' }
  | { kind: 'scroll'; atLatest: boolean; offsetY: number }
  | { kind: 'returnToLatest' };

export const INITIAL_TERMINAL_FOLLOW_STATE: TerminalFollowState = {
  mode: 'following',
  gesture: 'idle',
  atLatest: true,
  offsetY: 0,
};

export function terminalScrollAtLatest(
  metrics: { contentHeight: number; offsetY: number; viewportHeight: number },
  slack = TERMINAL_LATEST_SLACK_PX,
): boolean {
  return metrics.contentHeight - metrics.offsetY - metrics.viewportHeight < slack;
}

export function terminalFollowNext(
  state: TerminalFollowState,
  event: TerminalFollowEvent,
): TerminalFollowState {
  switch (event.kind) {
    case 'reset':
      return INITIAL_TERMINAL_FOLLOW_STATE;
    case 'dragBegin':
      return { ...state, mode: 'browsing', gesture: 'dragging' };
    case 'momentumBegin':
      return { ...state, gesture: 'momentum' };
    case 'dragEnd':
    case 'momentumEnd': {
      if (state.mode === 'returning' && !state.atLatest) {
        return { ...state, gesture: 'idle' };
      }
      return { ...state, mode: state.atLatest ? 'following' : 'browsing', gesture: 'idle' };
    }
    case 'returnToLatest':
      return { ...state, mode: 'returning', atLatest: true };
    case 'scroll': {
      if (state.mode === 'returning') {
        return {
          mode: event.atLatest ? 'following' : 'returning',
          gesture: state.gesture,
          atLatest: event.atLatest,
          offsetY: event.offsetY,
        };
      }
      if (state.mode === 'following') {
        return { ...state, atLatest: event.atLatest, offsetY: event.offsetY };
      }
      // See rule 3: the list must have moved toward the newest row itself.
      const movedTowardLatest = event.offsetY > state.offsetY;
      return {
        mode: event.atLatest && state.gesture === 'idle' && movedTowardLatest
          ? 'following'
          : 'browsing',
        gesture: state.gesture,
        atLatest: event.atLatest,
        offsetY: event.offsetY,
      };
    }
  }
}

/** Auto-follow may only move the anchor when no gesture owns it. */
export function terminalFollowAllowsAutoScroll(state: TerminalFollowState): boolean {
  return state.mode === 'following' && state.gesture === 'idle';
}

export function terminalFollowShowsLatestControl(state: TerminalFollowState): boolean {
  return state.mode === 'browsing' && !state.atLatest;
}
