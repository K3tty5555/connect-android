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

/** 底部弹层在 iPad 宽窗口里居中收窄到 560pt，不铺满整屏；窄窗口照旧贴边。 */
export function sheetHorizontalInset(width: number): number {
  return isTabletLayout(width) ? Math.max(0, Math.round((width - 560) / 2)) : 0;
}
