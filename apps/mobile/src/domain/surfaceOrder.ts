import { createContext } from 'react';
import type { SurfaceKind } from './session';

/**
 * 手机「新建会话」列表跟随电脑顶部按钮的隐藏与顺序（DESKTOP-TOOLBAR-BUTTONS-1025，
 * 用户 2026-10-25 拍板）。null = 电脑未提供（旧版），按完整四项原顺序显示。
 */
export const SurfaceOrderContext = createContext<readonly SurfaceKind[] | null>(null);

/**
 * Kimi Code（用户 2026-11-02）只在电脑明确列出时出现：电脑只对声明过的新手机列出它，
 * 旧电脑不认得 kimi，收到这种新建请求会直接断开连接，所以任何兜底都不含它。
 */
export function orderedSurfaces<T extends { kind: SurfaceKind }>(
  all: readonly T[],
  order: readonly SurfaceKind[] | null,
): T[] {
  const fallback = all.filter((surface) => surface.kind !== 'kimi');
  if (order === null) return fallback;
  const listed = order.flatMap((kind) => all.filter((surface) => surface.kind === kind));
  return listed.length > 0 ? listed : fallback;
}
