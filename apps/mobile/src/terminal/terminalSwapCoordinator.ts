export type TerminalSwapPhase = 'idle' | 'preparing' | 'painting' | 'failed';

export interface TerminalSwapSnapshot {
  generation: number;
  operationId: string | null;
  phase: TerminalSwapPhase;
  presentedPanelId: string | null;
  targetPanelId: string | null;
}

export type TerminalSwapBeginResult =
  | { kind: 'unchanged'; snapshot: TerminalSwapSnapshot }
  | { kind: 'restored'; canceledOperationId: string | null; snapshot: TerminalSwapSnapshot }
  | { kind: 'preparing' | 'painting'; operationId: string; snapshot: TerminalSwapSnapshot };

/** Separates the selected terminal from the last frame that is safe to present. */
export class TerminalSwapCoordinator {
  private generation = 0;
  private operationId: string | null = null;
  private phase: TerminalSwapPhase = 'idle';
  private presentedPanelId: string | null = null;
  private targetPanelId: string | null = null;

  begin(
    targetPanelId: string,
    operationId: string,
    frameAvailable: boolean,
    force = false,
  ): TerminalSwapBeginResult {
    if (!force && this.presentedPanelId === targetPanelId && this.targetPanelId !== targetPanelId) {
      const canceledOperationId = this.operationId;
      this.generation += 1;
      this.operationId = null;
      this.phase = 'idle';
      this.targetPanelId = targetPanelId;
      return { kind: 'restored', canceledOperationId, snapshot: this.snapshot() };
    }
    if (
      !force
      && this.targetPanelId === targetPanelId
      && (
        this.phase === 'preparing'
        || this.phase === 'painting'
        || (this.phase === 'idle' && this.presentedPanelId === targetPanelId)
      )
    ) {
      return { kind: 'unchanged', snapshot: this.snapshot() };
    }
    this.generation += 1;
    this.operationId = operationId;
    this.phase = frameAvailable ? 'painting' : 'preparing';
    this.targetPanelId = targetPanelId;
    return {
      kind: this.phase,
      operationId,
      snapshot: this.snapshot(),
    };
  }

  frameReady(panelId: string): string | null {
    if (
      this.targetPanelId !== panelId
      || this.operationId === null
      || (this.phase !== 'preparing' && this.phase !== 'failed')
    ) return null;
    this.phase = 'painting';
    return this.operationId;
  }

  /**
   * The operation the target is still waiting to hear back about.
   *
   * `frameReady` is a transition and only answers once; the frames that follow
   * it belong to the same unfinished paint. Read-only on purpose: the presenter
   * calls it after `frameReady` to keep naming the operation, and observing the
   * pre-transition phase would hand out an id the paint reply cannot settle.
   */
  paintingOperationId(panelId: string): string | null {
    if (this.phase !== 'painting' || this.targetPanelId !== panelId) return null;
    return this.operationId;
  }

  painted(operationId: string): string | null {
    if (this.phase !== 'painting' || this.operationId !== operationId) return null;
    const panelId = this.targetPanelId;
    this.presentedPanelId = panelId;
    this.operationId = null;
    this.phase = 'idle';
    return panelId;
  }

  fail(panelId: string, operationId?: string): boolean {
    if (
      this.targetPanelId !== panelId
      || (operationId !== undefined && this.operationId !== operationId)
      || this.phase === 'idle'
    ) return false;
    this.operationId = null;
    this.phase = 'failed';
    return true;
  }

  reset(): void {
    this.generation += 1;
    this.operationId = null;
    this.phase = 'idle';
    this.presentedPanelId = null;
    this.targetPanelId = null;
  }

  /**
   * Preparing freezes the old authoritative frame. Once replacement is queued,
   * only target output may follow it into the WebView.
   */
  outputPanelId(): string | null {
    if (this.phase === 'painting') return this.targetPanelId;
    if (this.phase === 'idle') return this.presentedPanelId;
    return null;
  }

  replacementPanelId(): string | null {
    return this.phase === 'idle' ? this.presentedPanelId : null;
  }

  snapshot(): TerminalSwapSnapshot {
    return {
      generation: this.generation,
      operationId: this.operationId,
      phase: this.phase,
      presentedPanelId: this.presentedPanelId,
      targetPanelId: this.targetPanelId,
    };
  }
}
