export interface LocalUnpairOperations {
  disconnect(): void;
  clearProfile(): Promise<void>;
  clearRuntime(): void;
}

/** Coalesces destructive local cleanup so duplicate taps cannot interleave it. */
export class LocalUnpairCoordinator {
  private pending: Promise<boolean> | null = null;

  run(operations: LocalUnpairOperations): Promise<boolean> {
    if (this.pending !== null) return this.pending;
    this.pending = (async () => {
      operations.disconnect();
      try {
        await operations.clearProfile();
      } catch {
        return false;
      }
      operations.clearRuntime();
      return true;
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
}
