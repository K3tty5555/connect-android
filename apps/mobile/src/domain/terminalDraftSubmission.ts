export interface TerminalDraftSettlement {
  targetId: string;
  restoredDraft: string | null;
}

interface PendingTerminalDraft {
  targetId: string;
  draft: string;
}

export class TerminalDraftSubmission {
  private readonly drafts = new Map<string, string>();
  private pending: PendingTerminalDraft | null = null;

  update(targetId: string, draft: string): void {
    this.drafts.set(targetId, draft);
  }

  begin(targetId: string, allowEmpty = false): string | null {
    const draft = this.currentDraft(targetId);
    if (this.pending !== null || (!allowEmpty && draft.trim().length === 0)) return null;
    this.pending = { targetId, draft };
    this.drafts.set(targetId, '');
    return draft;
  }

  settle(accepted: boolean): TerminalDraftSettlement | null {
    const pending = this.pending;
    if (pending === null) return null;
    this.pending = null;
    if (accepted || this.currentDraft(pending.targetId).length > 0) {
      return { targetId: pending.targetId, restoredDraft: null };
    }
    this.drafts.set(pending.targetId, pending.draft);
    return { targetId: pending.targetId, restoredDraft: pending.draft };
  }

  currentDraft(targetId: string): string {
    return this.drafts.get(targetId) ?? '';
  }

  clear(): void {
    this.drafts.clear();
    this.pending = null;
  }
}
