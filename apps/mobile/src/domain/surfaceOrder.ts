import { createContext } from 'react';
import type { SurfaceKind } from './session';

/**
 * 手机「新建会话」列表跟随电脑顶部按钮的隐藏与顺序（DESKTOP-TOOLBAR-BUTTONS-1025，
 * 用户 2026-10-25 拍板）。null = 电脑未提供（旧版），按完整四项原顺序显示。
 */
export const SurfaceOrderContext = createContext<readonly SurfaceKind[] | null>(null);

export function orderedSurfaces<T extends { kind: SurfaceKind }>(
  all: readonly T[],
  order: readonly SurfaceKind[] | null,
): T[] {
  if (order === null) return [...all];
  const listed = order.flatMap((kind) => all.filter((surface) => surface.kind === kind));
  return listed.length > 0 ? listed : [...all];
}
