/**
 * Serializes terminal input per panel. A slow or failed write on one panel
 * must not hold another panel's input hostage, and queued writes retain the
 * order in which the user produced them.
 */
export class TerminalInputQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly depths = new Map<string, number>();

  constructor(private readonly onDepthChange?: (panelId: string, depth: number) => void) {}

  enqueue(panelId: string, operation: () => Promise<void> | void): Promise<void> {
    const depth = (this.depths.get(panelId) ?? 0) + 1;
    this.depths.set(panelId, depth);
    this.onDepthChange?.(panelId, depth);
    const previous = this.tails.get(panelId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.tails.set(panelId, next);
    const cleanup = (): void => {
      const nextDepth = Math.max(0, (this.depths.get(panelId) ?? 1) - 1);
      if (nextDepth === 0) this.depths.delete(panelId);
      else this.depths.set(panelId, nextDepth);
      this.onDepthChange?.(panelId, nextDepth);
      if (this.tails.get(panelId) === next) this.tails.delete(panelId);
    };
    // Observe both outcomes so cleanup never creates an unhandled rejection.
    void next.then(cleanup, cleanup);
    return next;
  }

  clear(panelId?: string): void {
    if (panelId === undefined) {
      this.tails.clear();
      this.depths.clear();
    } else {
      this.tails.delete(panelId);
      this.depths.delete(panelId);
    }
  }

  depth(panelId: string): number {
    return this.depths.get(panelId) ?? 0;
  }
}
