import type { CrashLogEntry } from '../../../../src/shared/types';
import type { NativeCrashDiagnostic, NativeExitReason } from '../../modules/connect-terminal';
import { redactMessage, type CrashContext } from './jsFatalHandler';

/** Where the newest Android exit already recorded is remembered (document directory). */
export interface PreviousExitMarker {
  read(): string | null;
  write(text: string): void;
}

export interface PreviousExitNative {
  recentExitReasons: (() => NativeExitReason[]) | null;
  drainCrashDiagnostics: (() => NativeCrashDiagnostic[]) | null;
}

const MAX_MESSAGE = 500;
const MAX_LABEL = 120;
const MAX_FRAMES = 15;
const MAX_FRAME = 300;

const EXCEPTION_TYPES: Record<number, string> = {
  1: 'EXC_BAD_ACCESS',
  2: 'EXC_BAD_INSTRUCTION',
  3: 'EXC_ARITHMETIC',
  4: 'EXC_EMULATION',
  5: 'EXC_SOFTWARE',
  6: 'EXC_BREAKPOINT',
  7: 'EXC_SYSCALL',
  8: 'EXC_MACH_SYSCALL',
  9: 'EXC_RPC_ALERT',
  10: 'EXC_CRASH',
  11: 'EXC_RESOURCE',
  12: 'EXC_GUARD',
  13: 'EXC_CORPSE_NOTIFY',
};
const SIGNALS: Record<number, string> = {
  1: 'SIGHUP',
  2: 'SIGINT',
  3: 'SIGQUIT',
  4: 'SIGILL',
  5: 'SIGTRAP',
  6: 'SIGABRT',
  7: 'SIGEMT',
  8: 'SIGFPE',
  9: 'SIGKILL',
  10: 'SIGBUS',
  11: 'SIGSEGV',
  12: 'SIGSYS',
  13: 'SIGPIPE',
  14: 'SIGALRM',
  15: 'SIGTERM',
};

/**
 * Appends what the system knows about how the App last died (ADR-008): Android's
 * ApplicationExitInfo (crash, native crash, ANR, low memory, failed start, killed
 * by signal) and iOS MetricKit crash diagnostics. Android keeps a history, so
 * the newest timestamp already recorded is persisted and older rows skipped;
 * the iOS store is drained by native code, so each diagnostic arrives once.
 * Never throws.
 */
export function collectPreviousExits(deps: {
  platform: string;
  native: PreviousExitNative;
  marker: PreviousExitMarker;
  record(entry: CrashLogEntry): void;
  context: CrashContext;
}): void {
  try {
    if (deps.platform === 'android') collectAndroid(deps);
    else if (deps.platform === 'ios') collectIos(deps);
  } catch {
    // Diagnostics never break the App.
  }
}

/** Reasons that are also how Android routinely reclaims background apps: only a crash when the user was looking. */
const BACKGROUND_RECLAIM_REASONS = new Set(['low-memory', 'signaled']);
/** ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE; foreground (100) and visible (200) are in front of the user. */
const IMPORTANCE_VISIBLE = 200;

function collectAndroid(deps: Parameters<typeof collectPreviousExits>[0]): void {
  const read = deps.native.recentExitReasons;
  if (read === null) return;
  const lastSeen = readMarker(deps.marker);
  const exits = read()
    .filter((exit): exit is NativeExitReason => (
      exit !== null && typeof exit === 'object'
      && Number.isFinite(exit.timestamp) && typeof exit.reason === 'string'
    ))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (exits.length === 0) return;
  const newest = exits[exits.length - 1].timestamp;
  // First run (or an unreadable marker): the history predates this feature and
  // belongs to older versions, so only remember where it ends.
  if (lastSeen !== null) {
    for (const exit of exits) {
      if (exit.timestamp <= lastSeen) continue;
      if (BACKGROUND_RECLAIM_REASONS.has(exit.reason)
        && !(typeof exit.importance === 'number' && exit.importance <= IMPORTANCE_VISIBLE)) continue;
      const entry: CrashLogEntry = {
        at: new Date(exit.timestamp).toISOString(),
        kind: 'previous-exit',
        reason: exit.reason.slice(0, MAX_LABEL),
      };
      if (Number.isInteger(exit.status)) entry.exitCode = exit.status;
      if (typeof exit.description === 'string' && exit.description.trim() !== '') {
        entry.message = redactMessage(exit.description.trim());
      }
      // The exit may have happened under an older version; like iOS, this launch's version is not stamped.
      safeRecord(deps, { ...entry, platform: deps.context.platform, osRelease: deps.context.osRelease });
    }
  }
  if (lastSeen !== null && newest <= lastSeen) return;
  try {
    deps.marker.write(JSON.stringify({ androidExitMs: newest }));
  } catch {
    // Worst case the same exit is recorded again next launch.
  }
}

function collectIos(deps: Parameters<typeof collectPreviousExits>[0]): void {
  const drain = deps.native.drainCrashDiagnostics;
  if (drain === null) return;
  for (const crash of drain()) {
    if (crash === null || typeof crash !== 'object' || !Number.isFinite(crash.timestampMs)) continue;
    const entry: CrashLogEntry = {
      at: new Date(crash.timestampMs).toISOString(),
      kind: 'native-crash',
      name: crashName(crash).slice(0, MAX_LABEL),
    };
    if (Number.isFinite(crash.exceptionCode)) entry.code = String(crash.exceptionCode);
    if (typeof crash.terminationReason === 'string') {
      entry.reason = redactMessage(crash.terminationReason.trim()).slice(0, MAX_LABEL);
    }
    if (typeof crash.exceptionName === 'string') entry.errorName = crash.exceptionName.slice(0, MAX_LABEL);
    if (Array.isArray(crash.frames)) {
      entry.frames = crash.frames
        .filter((frame): frame is string => typeof frame === 'string')
        .slice(0, MAX_FRAMES)
        .map((frame) => frame.slice(0, MAX_FRAME));
    }
    // MetricKit carries the build number but not the version that crashed, so
    // this launch's version is deliberately not stamped on the entry.
    safeRecord(deps, {
      ...entry,
      platform: deps.context.platform,
      osRelease: typeof crash.osVersion === 'string' ? crash.osVersion.slice(0, 64) : deps.context.osRelease,
    });
  }
}

function crashName(crash: NativeCrashDiagnostic): string {
  const type = typeof crash.exceptionType === 'number'
    ? EXCEPTION_TYPES[crash.exceptionType] ?? `exception ${crash.exceptionType}`
    : null;
  const signal = typeof crash.signal === 'number'
    ? SIGNALS[crash.signal] ?? `signal ${crash.signal}`
    : null;
  if (type !== null && signal !== null) return `${type} (${signal})`;
  return type ?? signal ?? 'unknown';
}

/** The newest exit already handled, or null when there is no usable marker yet. */
function readMarker(marker: PreviousExitMarker): number | null {
  try {
    const text = marker.read();
    if (text === null) return null;
    const value = (JSON.parse(text) as { androidExitMs?: unknown }).androidExitMs;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function safeRecord(deps: { record(entry: CrashLogEntry): void }, entry: CrashLogEntry): void {
  try {
    deps.record(entry);
  } catch {
    // ignore
  }
}

function singleLine(text: string): string {
  return text.trim().replace(/\s*\n\s*/gu, ' | ');
}
