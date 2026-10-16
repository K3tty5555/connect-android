/**
 * The notification inbox is withdrawn: it never drove a real alert, so the tab
 * only offered a list nobody acted on. Re-adding it means restoring the tab
 * here, the screen, and the `listNotifications` traffic in `App.tsx` together.
 */
export type RootTab = 'home' | 'settings';

export type MobileRoute =
  | { kind: 'root'; tab: RootTab }
  | { kind: 'project'; workspaceCapability: string }
  | { kind: 'session'; workspaceCapability: string; panelId: string };

export type RouteEvent =
  | { type: 'restore'; route: MobileRoute }
  | { type: 'select_tab'; tab: RootTab }
  | { type: 'open_project'; workspaceCapability: string }
  | { type: 'open_session'; workspaceCapability: string; panelId: string }
  | { type: 'back' }
  | { type: 'reset' };

export const initialMobileRoute: MobileRoute = { kind: 'root', tab: 'home' };

export type MobileRouteTransition = 'none' | 'forward' | 'back' | 'tab';

export interface MobileNavigationSnapshot {
  generation: number;
  route: MobileRoute;
  transition: MobileRouteTransition;
}

export const initialMobileNavigation: MobileNavigationSnapshot = {
  generation: 0,
  route: initialMobileRoute,
  transition: 'none',
};

export function transitionForRouteEvent(event: RouteEvent): MobileRouteTransition {
  if (event.type === 'open_project' || event.type === 'open_session') return 'forward';
  if (event.type === 'back') return 'back';
  // 设置不再是底部 tab，而是从首页右上角推入的一层：进设置前推、回首页后退。
  if (event.type === 'select_tab') return event.tab === 'settings' ? 'forward' : 'back';
  return 'none';
}

export function mobileRouteKey(route: MobileRoute): string {
  if (route.kind === 'root') return `root:${route.tab}`;
  if (route.kind === 'project') return `project:${route.workspaceCapability}`;
  return `session:${route.workspaceCapability}:${route.panelId}`;
}

export function reduceMobileNavigation(
  snapshot: MobileNavigationSnapshot,
  event: RouteEvent,
): MobileNavigationSnapshot {
  const route = reduceMobileRoute(snapshot.route, event);
  if (mobileRouteKey(route) === mobileRouteKey(snapshot.route)) return snapshot;
  return {
    generation: snapshot.generation + 1,
    route,
    transition: transitionForRouteEvent(event),
  };
}

export function shouldRefreshSessionTerminal(
  route: MobileRoute,
  activePanel: { panelId: string; kind: string } | undefined,
): boolean {
  return route.kind === 'session'
    && route.panelId === activePanel?.panelId
    && activePanel.kind !== 'collaboration';
}

export function reduceMobileRoute(
  route: MobileRoute,
  event: RouteEvent,
): MobileRoute {
  if (event.type === 'restore') return event.route;
  if (event.type === 'reset') return initialMobileRoute;
  if (event.type === 'select_tab') return { kind: 'root', tab: event.tab };
  if (event.type === 'open_project') {
    if (event.workspaceCapability.length === 0) return route;
    return { kind: 'project', workspaceCapability: event.workspaceCapability };
  }
  if (event.type === 'open_session') {
    if (event.workspaceCapability.length === 0 || event.panelId.length === 0) return route;
    return {
      kind: 'session',
      workspaceCapability: event.workspaceCapability,
      panelId: event.panelId,
    };
  }
  if (route.kind === 'session') {
    return { kind: 'project', workspaceCapability: route.workspaceCapability };
  }
  if (route.kind === 'project') return initialMobileRoute;
  if (route.tab !== 'home') return initialMobileRoute;
  return route;
}
