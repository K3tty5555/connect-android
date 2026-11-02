import { Component, type ReactNode } from 'react';
import type { CrashLogEntry } from '../../../../src/shared/types';
import { describeJsFatal, type CrashContext } from './jsFatalHandler';

interface Props {
  children: ReactNode;
  record(entry: CrashLogEntry): void;
  context: CrashContext;
  now?: () => Date;
}

/**
 * Render errors never reach ErrorUtils: with no boundary, React Native's
 * onUncaughtError reports them as fatal and a release build crashes — with
 * nothing recorded (ADR-008). This boundary records the error and then throws
 * it again from its own render, so it still reaches the root uncaught and the
 * App fails exactly as it did before (pre-release review P1: swallowing it
 * turned a crash into a frozen blank screen).
 */
/**
 * React retries a failed render once before giving up, and the component throws
 * a fresh error object each time; the same failure within a moment is recorded once.
 */
const DUPLICATE_WINDOW_MS = 2_000;
let lastRecorded: { signature: string; atMs: number } | null = null;

export class CrashBoundary extends Component<Props, { caught: { error: unknown } | null }> {
  override state: { caught: { error: unknown } | null } = { caught: null };

  static getDerivedStateFromError(error: unknown): { caught: { error: unknown } } {
    return { caught: { error } };
  }

  override render(): ReactNode {
    const { caught } = this.state;
    if (caught === null) return this.props.children;
    const error = caught.error;
    try {
      const now = this.props.now ?? (() => new Date());
      const entry = { ...describeJsFatal(error, this.props.context, now), origin: 'render' };
      const signature = `${entry.errorName}|${entry.message ?? ''}|${entry.frames?.[0] ?? ''}`;
      const atMs = now().getTime();
      const duplicate = lastRecorded !== null && lastRecorded.signature === signature
        && Math.abs(atMs - lastRecorded.atMs) < DUPLICATE_WINDOW_MS;
      if (!duplicate) {
        lastRecorded = { signature, atMs };
        this.props.record(entry);
      }
    } catch {
      // Recording must never change how the App fails.
    }
    throw error;
  }
}
