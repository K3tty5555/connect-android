import { t } from '../i18n';
import type { SessionPanelSummary } from './session';

/** The Mac's own name for a shell panel; it has no idea which language the phone uses. */
const MAC_SHELL_LABEL = '终端';

/**
 * What the phone shows for a panel. The Mac names a shell panel
 * `终端 · <project>` regardless of language, so the phone swaps in its own word.
 * Only that exact default form is rewritten: agent names are brand names, rooms
 * carry the user's own title, and anything else passes through untouched.
 *
 * The raw label stays the identity (resume matching compares it), so this is
 * applied only where a label is displayed or spoken.
 */
export function panelDisplayLabel(
  panel: Pick<SessionPanelSummary, 'kind' | 'label' | 'workspaceLabel'>,
): string {
  if (
    panel.kind === 'shell'
    && panel.workspaceLabel !== undefined
    && panel.label === `${MAC_SHELL_LABEL} · ${panel.workspaceLabel}`
  ) {
    return `${t(MAC_SHELL_LABEL)} · ${panel.workspaceLabel}`;
  }
  return panel.label;
}
