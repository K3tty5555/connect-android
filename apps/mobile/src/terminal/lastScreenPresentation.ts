import type { MobileResumeTarget } from '../navigation/resumeTarget';
import { lastScreenMatches, type LastScreen } from './lastScreenStore';

/**
 * When the saved last screen may be shown, decided in one place.
 *
 * It stands for exactly one terminal: the one a cold start is resuming. Shown
 * over anything else — a same-named terminal in another project, a panel the
 * user opened by hand — it would present one terminal's content as another's.
 */
export interface LastScreenPresentationInput {
  lastScreen: LastScreen | null;
  /** Set for good by the first live paint, a failed attach, or giving up the resume. */
  retired: boolean;
  desktopKey: string | null;
  resumeTarget: MobileResumeTarget | null;
  /** The resume has been applied (or abandoned); the preview's moment has passed. */
  resumeSettled: boolean;
  /** The panel an exact resume landed on; null until then, or for good on a fallback. */
  resumedPanelId: string | null;
  nowMs: number;
}

function resumable(input: LastScreenPresentationInput): LastScreen | null {
  const target = input.resumeTarget;
  if (input.retired || input.desktopKey === null || target?.kind !== 'session') return null;
  return lastScreenMatches(input.lastScreen, {
    desktopKey: input.desktopKey,
    workspaceLabel: target.workspaceLabel,
    surfaceLabel: target.surfaceLabel,
    surfaceKind: target.surfaceKind,
  }, input.nowMs)
    ? input.lastScreen
    : null;
}

/** Cold start on 首页, before the resume can be applied. */
export function resumePreviewScreen(
  input: LastScreenPresentationInput & { onHomeRoute: boolean },
): LastScreen | null {
  if (!input.onHomeRoute || input.resumeSettled) return null;
  return resumable(input);
}

/** Over the resumed terminal until its first live paint. */
export function sessionLastScreen(
  input: LastScreenPresentationInput & { activePanelId: string | null },
): LastScreen | null {
  if (input.resumedPanelId === null || input.activePanelId !== input.resumedPanelId) return null;
  return resumable(input);
}
