import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
} from '../../../../src/shared/terminalGeometry';
import type { ConnectionState, OwnershipState } from '../domain/session';

/**
 * Decides whether this phone may resize the shared PTY.
 *
 * The shared PTY's geometry is the desktop's by default. Earlier rounds
 * (dev-log 237 / 260 / 269) settled that wrapping quality must never be bought
 * by hijacking it, and that rule still binds every read-only path.
 *
 * On 2026-09-10 the user decided the takeover case differently: while the phone
 * holds input, the panel is being driven from the phone, so the phone's shape is
 * the authoritative one and the desktop's is restored on return. That is the
 * only case this gate opens, and it demands the same conditions the desktop
 * already enforces in `mobileBridgeServer.doResize`.
 *
 * On 2026-09-27 the user extended it to the default Reflow View, after UU
 * Remote showed what a TUI laid out for the phone looks like: the desktop
 * covers the panel while the phone holds it, so its shape does not matter
 * until it takes the panel back. The desktop now splits recorded rows instead
 * of clamping them when the PTY narrows, which is what used to rule reflow out.
 */

/**
 * Matches the terminal-grid contract's geometry bounds, with one narrowing: the
 * shared column floor. The contract still accepts two columns — the desktop
 * clamps anything below the floor rather than refusing it, so older phones keep
 * working — but this phone must not ask for a shape it cannot be given
 * (dev-log 313).
 */
const MIN_COLS = TERMINAL_MIN_COLS;
const MAX_COLS = TERMINAL_MAX_COLS;
const MIN_ROWS = TERMINAL_MIN_ROWS;
const MAX_ROWS = TERMINAL_MAX_ROWS;

export interface PtyGeometry {
  cols: number;
  rows: number;
}

export interface GeometryHandoverState {
  connection: ConnectionState;
  ownership: OwnershipState;
  /** True only for a device the desktop granted `write` scope. */
  canControlInput: boolean;
  /** The keyboard shrinks the viewport; it must not reshape the PTY. */
  keyboardVisible: boolean;
  isDemo: boolean;
  /**
   * The native views lay the TUI out at the phone's own width. The WebView
   * fallback still renders the desktop's width, so it never asks.
   */
  presentation: 'reflow-view' | 'exact-grid-view' | 'webview' | 'swiftterm-view';
  /**
   * The user's setting. Off, the phone never reshapes the PTY and reads the
   * desktop's shape the way it did before takeover followed the phone.
   */
  followsPhone: boolean;
}

export function isValidPtyGeometry(geometry: PtyGeometry): boolean {
  return Number.isInteger(geometry.cols)
    && Number.isInteger(geometry.rows)
    && geometry.cols >= MIN_COLS
    && geometry.cols <= MAX_COLS
    && geometry.rows >= MIN_ROWS
    && geometry.rows <= MAX_ROWS;
}

export function shouldSendPtyResize(
  state: GeometryHandoverState,
  next: PtyGeometry,
  last: PtyGeometry | null,
): boolean {
  if (state.isDemo) return false;
  if (!state.followsPhone) return false;
  if (state.presentation === 'webview') return false;
  if (state.connection !== 'online') return false;
  if (state.ownership !== 'mobile_owned') return false;
  if (!state.canControlInput) return false;
  if (state.keyboardVisible) return false;
  if (!isValidPtyGeometry(next)) return false;
  return last === null || last.cols !== next.cols || last.rows !== next.rows;
}

export interface GeometryHandoverTarget {
  state: GeometryHandoverState;
  panelId: string;
  epoch: number;
}

/**
 * How long a sent geometry may take to show up in the frames before it counts
 * as lost. Frames already in flight still carry the old shape; this has to
 * outlast them on a relayed link.
 */
export const PTY_GEOMETRY_CONFIRM_MS = 2_000;

/**
 * Debounces layout into at most one resize per settled layout.
 *
 * What was sent is remembered per panel and ownership epoch: the desktop
 * restores its own shape whenever control returns, so the next takeover must
 * send again even though the phone's layout never changed. `settle` re-offers
 * the last layout for exactly that case — taking over, switching panel or
 * switching view does not necessarily lay anything out again.
 *
 * The system keyboard never reports at all (see `keyboardVisible`); the
 * in-app keyboard and quick keys report as transient and are ignored once a
 * settled layout is known.
 *
 * Sending is not the same as taking effect. The desktop drops a resize that
 * arrives within its rate limit without answering, so `observe` checks the
 * shape the frames actually report. One that still disagrees well after the
 * send is offered again — once, so a shape the desktop will never take cannot
 * turn into a resize per frame.
 */
export function createPtyGeometryHandover(deps: {
  settleMs: number;
  confirmMs?: number;
  now?(): number;
  target(): GeometryHandoverTarget | null;
  send(panelId: string, geometry: PtyGeometry): Promise<void>;
}): {
  report(geometry: PtyGeometry, transient?: boolean): void;
  /** The system keyboard starting to show or hide, from its native event. */
  keyboard(visible: boolean): void;
  settle(): void;
  observe(panelId: string, geometry: PtyGeometry): void;
  dispose(): void;
} {
  const now = deps.now ?? Date.now;
  const confirmMs = deps.confirmMs ?? PTY_GEOMETRY_CONFIRM_MS;
  let viewport: PtyGeometry | null = null;
  /** Whether `viewport` came from a layout squeezed by input chrome. */
  let viewportTransient = false;
  /**
   * Whether `viewport` was measured while the system keyboard was up.
   *
   * Tracked from the keyboard's native will-show/will-hide events, not from
   * React state: the avoiding view lays out on the UI thread as soon as the
   * keyboard starts to move, and state that re-renders later let the first
   * squeezed layouts through as the phone's real shape.
   */
  let keyboardUp = false;
  let viewportUnderKeyboard = false;
  let sent: (PtyGeometry & {
    panelId: string;
    epoch: number;
    atMs: number;
    retried: boolean;
  }) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retrying = false;
  const settle = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const target = deps.target();
      if (viewport === null || target === null) {
        // The retry belonged to the send that failed; it must not mark the
        // next takeover's first send as already retried.
        retrying = false;
        return;
      }
      const { panelId, epoch } = target;
      const last = sent?.panelId === panelId && sent.epoch === epoch ? sent : null;
      // The keyboard rule is about the layout being offered, not the moment:
      // a shape measured with the keyboard down is still the phone's shape
      // when the user takes over mid-typing. Waiting for the keyboard to close
      // left the PTY at the desktop's width for as long as they typed.
      const state = { ...target.state, keyboardVisible: viewportUnderKeyboard };
      if (!shouldSendPtyResize(state, viewport, last)) {
        retrying = false;
        return;
      }
      const next = {
        ...viewport,
        panelId,
        epoch,
        atMs: now(),
        retried: retrying && last === null,
      };
      retrying = false;
      sent = next;
      deps.send(panelId, viewport).catch(() => {
        // A refused or dropped resize only means the desktop keeps its shape.
        if (sent === next) sent = null;
      });
    }, deps.settleMs);
  };
  return {
    report(geometry, transient = false) {
      // A layout measured under the system keyboard is squeezed like any other.
      if (keyboardUp) {
        if (viewport !== null && !viewportUnderKeyboard) return;
        viewport = geometry;
        viewportTransient = true;
        viewportUnderKeyboard = true;
        settle();
        return;
      }
      // Input chrome opens and closes all the time, and every new shape makes
      // the CLI repaint its whole screen. Only when no settled layout exists
      // yet does a squeezed one stand in for it.
      if (transient && viewport !== null && !viewportTransient) return;
      viewport = geometry;
      viewportTransient = transient;
      viewportUnderKeyboard = false;
      settle();
    },
    keyboard(visible) {
      keyboardUp = visible;
    },
    settle,
    observe(panelId, geometry) {
      const last = sent;
      if (last === null || last.panelId !== panelId || last.retried) return;
      if (last.cols === geometry.cols && last.rows === geometry.rows) return;
      if (now() - last.atMs < confirmMs) return;
      // Forget it so the gate treats the shape as unsent, and remember that
      // this attempt is the one retry it gets.
      sent = null;
      retrying = true;
      settle();
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
