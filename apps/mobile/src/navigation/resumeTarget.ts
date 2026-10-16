import type {
  ConnectionState,
  SessionPanelSummary,
  SessionWorkspaceSummary,
  SurfaceKind,
} from '../domain/session';
import type { MobileRoute, RootTab } from './routes';

const LABEL_MAX = 160;
const DRAFT_MAX = 4_000;

export type MobileResumeTarget =
  | { v: 1; kind: 'root'; tab: RootTab }
  | { v: 1; kind: 'project'; workspaceLabel: string }
  | {
      v: 1;
      kind: 'session';
      workspaceLabel: string;
      surfaceLabel: string;
      surfaceKind: SurfaceKind;
      draft: string;
    };

export interface ResolvedMobileResumeTarget {
  route: MobileRoute;
  panelId: string | null;
  draft: string;
  outcome: 'exact' | 'project_fallback' | 'home_fallback';
}

export function shouldApplyMobileResumeTarget(input: {
  applied: boolean;
  catalogReady: boolean;
  connection: ConnectionState;
  loaded: boolean;
  target: MobileResumeTarget | null;
}): boolean {
  if (!input.loaded || input.applied || input.target === null) return false;
  return input.target.kind === 'root'
    || (input.connection === 'online' && input.catalogReady);
}

export function parseMobileResumeTarget(value: unknown): MobileResumeTarget | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (record.v !== 1) return null;
  if (
    record.kind === 'root'
    && keys.length === 3
    && keys.every((key) => ['v', 'kind', 'tab'].includes(key))
    // A record saved by a build that still had the notification tab resolves to
    // null here, which resumes on 首页 rather than a tab that no longer exists.
    && (record.tab === 'home' || record.tab === 'settings')
  ) {
    return record as unknown as MobileResumeTarget;
  }
  if (
    record.kind === 'project'
    && keys.length === 3
    && keys.every((key) => ['v', 'kind', 'workspaceLabel'].includes(key))
    && validLabel(record.workspaceLabel)
  ) return record as unknown as MobileResumeTarget;
  if (
    record.kind === 'session'
    && keys.length === 6
    && keys.every((key) => [
      'v', 'kind', 'workspaceLabel', 'surfaceLabel', 'surfaceKind', 'draft',
    ].includes(key))
    && validLabel(record.workspaceLabel)
    && validLabel(record.surfaceLabel)
    && ['claude', 'codex', 'shell', 'collaboration'].includes(String(record.surfaceKind))
    && typeof record.draft === 'string'
    && record.draft.length <= DRAFT_MAX
    && !record.draft.includes('\0')
  ) return record as unknown as MobileResumeTarget;
  return null;
}

export function describeMobileResumeTarget(
  route: MobileRoute,
  workspaces: readonly SessionWorkspaceSummary[],
  panels: readonly SessionPanelSummary[],
  draft: string,
): MobileResumeTarget | null {
  if (route.kind === 'root') return { v: 1, kind: 'root', tab: route.tab };
  const workspace = workspaces.find(
    (candidate) => candidate.workspaceCapability === route.workspaceCapability,
  );
  if (workspace === undefined || !validLabel(workspace.label)) return null;
  if (route.kind === 'project') {
    return { v: 1, kind: 'project', workspaceLabel: workspace.label };
  }
  const panel = panels.find((candidate) => candidate.panelId === route.panelId);
  if (panel === undefined || !validLabel(panel.label)) return null;
  return {
    v: 1,
    kind: 'session',
    workspaceLabel: workspace.label,
    surfaceLabel: panel.label,
    surfaceKind: panel.kind,
    draft: draft.slice(0, DRAFT_MAX),
  };
}

export function resolveMobileResumeTarget(
  target: MobileResumeTarget,
  workspaces: readonly SessionWorkspaceSummary[],
  panels: readonly SessionPanelSummary[],
): ResolvedMobileResumeTarget {
  if (target.kind === 'root') {
    return {
      route: { kind: 'root', tab: target.tab },
      panelId: null,
      draft: '',
      outcome: 'exact',
    };
  }
  const matchingWorkspaces = workspaces.filter(
    (workspace) => workspace.label === target.workspaceLabel,
  );
  if (matchingWorkspaces.length !== 1) return homeFallback();
  const workspace = matchingWorkspaces[0]!;
  const projectRoute: MobileRoute = {
    kind: 'project',
    workspaceCapability: workspace.workspaceCapability,
  };
  if (target.kind === 'project') {
    return { route: projectRoute, panelId: null, draft: '', outcome: 'exact' };
  }
  const matchingPanels = panels.filter((panel) => (
    panel.workspaceCapability === workspace.workspaceCapability
    && panel.label === target.surfaceLabel
    && panel.kind === target.surfaceKind
  ));
  if (matchingPanels.length !== 1) {
    return { route: projectRoute, panelId: null, draft: '', outcome: 'project_fallback' };
  }
  const panel = matchingPanels[0]!;
  return {
    route: {
      kind: 'session',
      workspaceCapability: workspace.workspaceCapability,
      panelId: panel.panelId,
    },
    panelId: panel.panelId,
    draft: target.draft,
    outcome: 'exact',
  };
}

export function resolveMobileRouteRevalidation(
  route: MobileRoute,
  target: MobileResumeTarget | null,
  workspaces: readonly SessionWorkspaceSummary[],
  panels: readonly SessionPanelSummary[],
): ResolvedMobileResumeTarget | null {
  if (route.kind === 'root') return null;
  const workspace = workspaces.find(
    (candidate) => candidate.workspaceCapability === route.workspaceCapability,
  );
  if (workspace !== undefined) {
    if (route.kind === 'project') return null;
    const panelStillExists = panels.some((panel) => (
      panel.panelId === route.panelId
      && panel.workspaceCapability === route.workspaceCapability
    ));
    if (panelStillExists) return null;
  }
  if (target !== null && target.kind !== 'root') {
    return resolveMobileResumeTarget(target, workspaces, panels);
  }
  if (workspace !== undefined) {
    return {
      route: { kind: 'project', workspaceCapability: workspace.workspaceCapability },
      panelId: null,
      draft: '',
      outcome: 'project_fallback',
    };
  }
  return homeFallback();
}

function validLabel(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= LABEL_MAX
    && !value.includes('\0');
}

function homeFallback(): ResolvedMobileResumeTarget {
  return {
    route: { kind: 'root', tab: 'home' },
    panelId: null,
    draft: '',
    outcome: 'home_fallback',
  };
}
