import type { BrowserPanelEntry } from '../domain/browserMirrorSession';
import type { SessionWorkspaceSummary } from '../domain/session';
import type { TabletFileTab } from './TabletTabStrip';

/**
 * iPad 排版按窗口宽度而不是设备型号：分屏/台前调度下 iPad 窗口可能只有 iPhone 宽，
 * 那时回落到 iPhone 的栈式导航（IPAD-01）。
 */
export const TABLET_MIN_WIDTH = 700;

export function isTabletLayout(width: number): boolean {
  return width >= TABLET_MIN_WIDTH;
}

/** 横屏给 Mac 同宽的侧栏；竖屏收窄，主区仍留够终端宽度。 */
export function tabletSidebarWidth(width: number): number {
  return width >= 1000 ? 300 : 264;
}

/**
 * 重连后 workspace capability 会轮换：按唯一 label 把文件标签对到新 capability，
 * 对不上（项目已关闭或重名）就关掉——与路由重验 `resolveMobileRouteRevalidation` 同口径。
 */
export function remapTabletFileTabs(
  tabs: readonly TabletFileTab[],
  workspaces: readonly SessionWorkspaceSummary[],
): TabletFileTab[] {
  const next: TabletFileTab[] = [];
  for (const tab of tabs) {
    if (workspaces.some((workspace) => workspace.workspaceCapability === tab.workspaceCapability)) {
      next.push(tab);
      continue;
    }
    const matches = workspaces.filter((workspace) => workspace.label === tab.workspaceLabel);
    if (matches.length === 1) next.push({ ...tab, workspaceCapability: matches[0]!.workspaceCapability });
  }
  return next;
}

/**
 * iPad 主区里的网页镜像标签（ADR-003 §19）。只记桌面签发的不透明 `bcap_*` 与标题，
 * 和会话标签一样**永远不出现 URL 或路径**。
 */
export interface TabletBrowserTab {
  browserCapability: string;
  title: string;
  workspaceCapability: string;
}

/**
 * 标签与桌面目录对账：在线时桌面不再列出这个面板就撤掉标签（面板已在电脑上关闭）；
 * 还在就顺带把标题与所属项目刷成桌面的权威值（capability 轮换后仍对得上）。
 * 离线时目录本来就是空的，不作数——保留到重连后再判，与「断线保持」同口径。
 */
export function resolveTabletBrowserTab(
  tab: TabletBrowserTab | null,
  panels: readonly BrowserPanelEntry[],
  online: boolean,
): TabletBrowserTab | null {
  if (tab === null) return null;
  if (!online) return tab;
  const entry = panels.find((panel) => panel.browserCapability === tab.browserCapability);
  if (entry === undefined) return null;
  if (entry.title === tab.title && entry.workspaceCapability === tab.workspaceCapability) return tab;
  return {
    browserCapability: tab.browserCapability,
    title: entry.title,
    workspaceCapability: entry.workspaceCapability,
  };
}

/**
 * 网页镜像的呈现位置：iPad 宽窗口进主区标签（`pane`，与文件标签同构）；
 * 窄窗口（分屏 / 台前调度回落到 iPhone 版式）仍是全屏 `modal`，与手机一致。
 */
export function browserMirrorChrome(input: {
  tabletLayout: boolean;
  open: boolean;
}): 'pane' | 'modal' | 'hidden' {
  if (!input.open) return 'hidden';
  return input.tabletLayout ? 'pane' : 'modal';
}

/** 底部弹层在 iPad 宽窗口里居中收窄到 560pt，不铺满整屏；窄窗口照旧贴边。 */
export function sheetHorizontalInset(width: number): number {
  return isTabletLayout(width) ? Math.max(0, Math.round((width - 560) / 2)) : 0;
}
