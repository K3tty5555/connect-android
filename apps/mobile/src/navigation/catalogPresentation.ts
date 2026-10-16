import type {
  SessionPanelSummary,
  SessionWorkspaceSummary,
} from '../domain/session';
import { mobileRouteKey, type MobileRoute } from './routes';

export interface MobileRouteCatalogSnapshot {
  key: string;
  panels: SessionPanelSummary[];
  workspace: SessionWorkspaceSummary;
}

export interface MobileRouteCatalogPresentation {
  contentReady: boolean;
  snapshot: MobileRouteCatalogSnapshot | null;
}

export function presentMobileRouteCatalog(
  previous: MobileRouteCatalogSnapshot | null,
  route: MobileRoute,
  workspaces: readonly SessionWorkspaceSummary[],
  panels: readonly SessionPanelSummary[],
  catalogSettled: boolean,
): MobileRouteCatalogPresentation {
  if (route.kind === 'root') return { contentReady: true, snapshot: null };
  const key = mobileRouteKey(route);
  const retained = previous?.key === key ? previous : null;
  if (!catalogSettled) return { contentReady: retained !== null, snapshot: retained };

  const workspace = workspaces.find(
    (candidate) => candidate.workspaceCapability === route.workspaceCapability,
  );
  if (workspace === undefined) {
    return { contentReady: retained !== null, snapshot: retained };
  }
  const routePanels = panels.filter(
    (panel) => panel.workspaceCapability === route.workspaceCapability,
  );
  if (
    route.kind === 'session'
    && !routePanels.some((panel) => panel.panelId === route.panelId)
  ) {
    return { contentReady: retained !== null, snapshot: retained };
  }
  return {
    contentReady: true,
    snapshot: { key, panels: routePanels, workspace },
  };
}
