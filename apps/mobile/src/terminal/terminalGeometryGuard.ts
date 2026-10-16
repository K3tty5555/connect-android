import type { TerminalGeometry } from './terminalSegments';

export type TerminalGeometryDisposition = 'accept' | 'recover' | 'suppress';

interface GeometryState {
  applied: TerminalGeometry;
  appliedSeq: number;
  recovering: boolean;
}

function sameGeometry(left: TerminalGeometry, right: TerminalGeometry): boolean {
  return left.cols === right.cols && left.rows === right.rows;
}

/** Prevents incremental ANSI/TUI output from crossing an unapplied PTY resize. */
export class TerminalGeometryGuard {
  private readonly panels = new Map<string, GeometryState>();

  observe(
    panelId: string,
    geometry: TerminalGeometry | undefined,
    sequence?: number,
  ): TerminalGeometryDisposition {
    const current = this.panels.get(panelId);
    if (current !== undefined && sequence !== undefined && sequence <= current.appliedSeq) {
      return 'suppress';
    }
    if (current?.recovering) return 'suppress';
    if (geometry === undefined) {
      if (current !== undefined && sequence !== undefined) current.appliedSeq = sequence;
      return 'accept';
    }
    if (current === undefined) {
      this.panels.set(panelId, {
        applied: { ...geometry },
        appliedSeq: sequence ?? 0,
        recovering: false,
      });
      return 'accept';
    }
    if (sameGeometry(current.applied, geometry)) {
      if (sequence !== undefined) current.appliedSeq = sequence;
      return 'accept';
    }
    current.recovering = true;
    return 'recover';
  }

  replace(panelId: string, geometry: TerminalGeometry, sequence?: number): boolean {
    const current = this.panels.get(panelId);
    if (current !== undefined && sequence !== undefined && sequence < current.appliedSeq) {
      return false;
    }
    this.panels.set(panelId, {
      applied: { ...geometry },
      appliedSeq: sequence ?? current?.appliedSeq ?? 0,
      recovering: false,
    });
    return true;
  }

  fail(panelId: string): void {
    const current = this.panels.get(panelId);
    if (current) current.recovering = false;
  }

  remove(panelId: string): void {
    this.panels.delete(panelId);
  }

  clear(): void {
    this.panels.clear();
  }
}
