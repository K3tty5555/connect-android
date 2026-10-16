export type MobileConnectionRecoveryReason =
  | 'foreground'
  | 'liveness'
  | 'secure_channel'
  | 'socket_close';

export type MobileConnectionRecoveryPhase = 'idle' | 'scheduled' | 'dialing';

export interface MobileConnectionRecoveryLease {
  generation: number;
  started: boolean;
}

export interface MobileConnectionRecoverySnapshot {
  generation: number;
  phase: MobileConnectionRecoveryPhase;
  reasons: MobileConnectionRecoveryReason[];
}

/** Coalesces every automatic reconnect source behind one generation-safe lease. */
export class MobileConnectionRecoveryOwner {
  private generation = 0;
  private phase: MobileConnectionRecoveryPhase = 'idle';
  private readonly reasons = new Set<MobileConnectionRecoveryReason>();

  request(reason: MobileConnectionRecoveryReason): MobileConnectionRecoveryLease {
    if (this.phase !== 'idle') {
      this.reasons.add(reason);
      return { generation: this.generation, started: false };
    }
    this.generation = this.generation === Number.MAX_SAFE_INTEGER ? 1 : this.generation + 1;
    this.phase = 'scheduled';
    this.reasons.clear();
    this.reasons.add(reason);
    return { generation: this.generation, started: true };
  }

  beginDial(generation: number): boolean {
    if (generation !== this.generation || this.phase !== 'scheduled') return false;
    this.phase = 'dialing';
    return true;
  }

  finish(generation: number): boolean {
    if (generation !== this.generation || this.phase === 'idle') return false;
    this.phase = 'idle';
    this.reasons.clear();
    return true;
  }

  cancel(): void {
    this.generation = this.generation === Number.MAX_SAFE_INTEGER ? 1 : this.generation + 1;
    this.phase = 'idle';
    this.reasons.clear();
  }

  snapshot(): MobileConnectionRecoverySnapshot {
    return {
      generation: this.generation,
      phase: this.phase,
      reasons: [...this.reasons],
    };
  }
}
