import type { DisplayedBrowserFrame } from './browserMirrorSession';

/**
 * 网页镜像的帧通道（2026-10-28「手机端画面不动」整改）。
 *
 * 帧是高频载荷（3–10 帧/秒、几十 KB base64）：走 App 级 state 会让每一帧都
 * 重渲整棵 App 树（真机上每帧数百毫秒到秒级），再叠加「一帧在途等 Ack」的
 * 节奏，画面帧率坍缩到目视静止。帧本体因此放进这个独立 host：只有订阅了
 * host 的画面叶子组件随帧重渲，App 树与状态机只感知低频的生命周期事件。
 *
 * Ack 簿记（每帧只确认一次、只在活动流上确认）也在这里：host 是唯一知道
 * 「当前显示的是哪一帧」的地方。
 */
export class BrowserFrameHost {
  private current: DisplayedBrowserFrame | null = null;
  private ackedSeq = 0;
  private live = false;
  /** 新流的下一帧不受「序号只前进」约束（重连后 seq 从 1 重新计数）。 */
  private acceptNextRegardless = false;
  private readonly listeners = new Set<() => void>();

  /** 帧到达：同一流内序号只前进；旧帧/重放不覆盖新画面（与旧 reducer 口径一致）。 */
  setFrame(frame: DisplayedBrowserFrame): void {
    const accept = this.acceptNextRegardless
      || this.current === null
      || frame.seq > this.current.seq;
    if (!accept) return;
    this.acceptNextRegardless = false;
    this.current = frame;
    this.live = true;
    this.emit();
  }

  /** 新一路流开始（view_started）：帧保留垫底，但 Ack 簿记作废（新流序号重新计数）。 */
  markStreamRestarted(): void {
    this.ackedSeq = 0;
    this.acceptNextRegardless = true;
  }

  /** 观看器关闭 / 换面板：清空画面与簿记。 */
  reset(): void {
    if (this.current === null && !this.live) return;
    this.current = null;
    this.live = false;
    this.ackedSeq = 0;
    this.emit();
  }

  get frame(): DisplayedBrowserFrame | null {
    return this.current;
  }

  get hasFrame(): boolean {
    return this.current !== null;
  }

  /**
   * 「显示完一帧才确认」（设计 §5.4）：由画面叶子的 Image onLoad 调用。
   * 同一帧只确认一次；不在活动流上（从未收帧 / 已重置）不确认。
   */
  ackForDisplayed(): { seq: number } | null {
    if (this.current === null || !this.live) return null;
    if (!Number.isSafeInteger(this.current.seq) || this.current.seq < 1) return null;
    if (this.current.seq <= this.ackedSeq) return null;
    this.ackedSeq = this.current.seq;
    return { seq: this.current.seq };
  }

  // ── 订阅（useSyncExternalStore 口径）───────────────────────────────────────
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // 一个订阅者出错不能拦住其他订阅者（与事件总线同口径）。
      }
    }
  }
}
