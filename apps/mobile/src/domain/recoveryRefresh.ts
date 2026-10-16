/**
 * Recovery-path catalog refreshes must not fail silently.
 *
 * 2026-09-15 验收 P3-02：`closedTerminalReconciler` **本身就是**「关闭未确认」的恢复
 * 路径，它的刷新请求写成 `void bridge.current?.send({ kind: 'listPanels' }).catch(() => {})`。
 * 两种失败都不产生任何信号：
 *
 * - 连接已断时 `send()` 返回被拒 promise，被 `.catch(() => {})` 吞掉；
 * - 客户端已释放时 `bridge.current?.send(...)` 直接求值为 `undefined`，**连拒绝都没有**，
 *   对账器会对着一个答不了的客户端把整个尝试预算（生产配置 20 × 500ms）烧完。
 *
 * 两种情况下用户都只能看着陈旧的会话列表，直到 `onTimeout` 才第一次收到提示。
 *
 * 只有恢复路径需要这样处理。App.tsx 其余几处纯机会性刷新保持静默 `.catch(() => {})`，
 * 它们背后有别的恢复路径兜底（验收报告同款结论，不要顺手一起改）。
 */
export type RecoveryRefreshSender = (() => Promise<unknown>) | null | undefined;

export function runRecoveryRefresh(
  send: RecoveryRefreshSender,
  onUnavailable: () => void,
): void {
  if (!send) {
    onUnavailable();
    return;
  }
  // `BridgeClient.send` 是 async 方法，不会同步抛出——失败一律经 promise 拒绝到达。
  void send().catch(() => { onUnavailable(); });
}
