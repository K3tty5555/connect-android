export class TerminalRecoveryCoordinator {
  private readonly pending = new Set<string>();
  private readonly blocked = new Map<string, string | undefined>();

  beginAutomatic(panelId: string): boolean {
    if (this.pending.has(panelId) || this.blocked.has(panelId)) return false;
    this.pending.add(panelId);
    return true;
  }

  beginManual(panelId: string): boolean {
    if (this.pending.has(panelId)) return false;
    this.blocked.delete(panelId);
    this.pending.add(panelId);
    return true;
  }

  block(panelId: string, detail?: string): void {
    this.pending.delete(panelId);
    this.blocked.set(panelId, detail);
  }

  complete(panelId: string): void {
    this.pending.delete(panelId);
    this.blocked.delete(panelId);
  }

  fail(panelId: string): void {
    this.pending.delete(panelId);
  }

  isBlocked(panelId: string): boolean {
    return this.blocked.has(panelId);
  }

  blockedDetail(panelId: string): string | undefined {
    return this.blocked.get(panelId);
  }

  forgetMissing(livePanelIds: ReadonlySet<string>): void {
    for (const panelId of this.pending) {
      if (!livePanelIds.has(panelId)) this.pending.delete(panelId);
    }
    for (const panelId of this.blocked.keys()) {
      if (!livePanelIds.has(panelId)) this.blocked.delete(panelId);
    }
  }

  releasePending(): void {
    this.pending.clear();
  }

  clear(): void {
    this.pending.clear();
    this.blocked.clear();
  }
}
