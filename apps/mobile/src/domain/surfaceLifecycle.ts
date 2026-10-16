import type { SessionPanelSummary } from './session';

export function adjacentPanelAfterClose(
  panels: readonly SessionPanelSummary[],
  closingPanelId: string,
): SessionPanelSummary | null {
  const index = panels.findIndex((panel) => panel.panelId === closingPanelId);
  if (index < 0) return null;
  const closing = panels[index]!;
  const sameWorkspace = panels.filter((panel) => (
    panel.workspaceCapability === closing.workspaceCapability
  ));
  const workspaceIndex = sameWorkspace.findIndex((panel) => panel.panelId === closingPanelId);
  return sameWorkspace[workspaceIndex + 1] ?? sameWorkspace[workspaceIndex - 1] ?? null;
}

export function insertExitTombstone(
  panels: readonly SessionPanelSummary[],
  closingPanel: SessionPanelSummary | null,
  closingIndex: number,
): SessionPanelSummary[] {
  if (closingPanel === null || panels.some((panel) => panel.panelId === closingPanel.panelId)) {
    return [...panels];
  }
  const next = [...panels];
  next.splice(Math.max(0, Math.min(closingIndex, next.length)), 0, closingPanel);
  return next;
}
