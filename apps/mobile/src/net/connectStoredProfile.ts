import type { PairedDesktopProfile } from './bridgeClient';
import type { DesktopEndpoint } from './pairedDesktop';

/**
 * 用已保存的配对资料发起连接（ADR-003 §17 回退地址）。
 * 先读回退地址再连；读失败按无回退处理。连接发出后若 App 仍在后台则立即挂起——
 * suspend() 在 connect() 之前调用会因还没有档案而直接返回，冷启动于后台时就会照常拨号。
 */
export async function connectStoredProfile(options: {
  profile: PairedDesktopProfile;
  loadFallback: (profile: PairedDesktopProfile) => Promise<DesktopEndpoint | null>;
  isActive: () => boolean;
  isBackground: () => boolean;
  connect: (profile: PairedDesktopProfile, fallback: DesktopEndpoint | null) => void;
  suspend: () => void;
}): Promise<void> {
  const fallback = await options.loadFallback(options.profile).catch(() => null);
  if (!options.isActive()) return;
  options.connect(options.profile, fallback);
  if (options.isBackground()) options.suspend();
}
