import type { TerminalGridRow } from '../../../../src/shared/types';
import type { SurfaceKind } from '../domain/session';
import type { NativeTerminalGridState } from './terminalGridModel';
import type { TerminalTranscriptSnapshot } from './terminalTranscriptCache';
import type { TerminalSegment } from './terminalSegments';

/**
 * The last terminal screen, kept on the phone so a cold start has something
 * to show while the connection is still being made.
 *
 * On a relayed Tailscale path the first live frame is several round trips
 * away — measured 1.4–5.6 s to connect plus ~0.65 s to attach. The user
 * approved keeping one screen on the device for that (2026-09-29): only the
 * last terminal they were in, bounded, bound to the paired desktop, gone after
 * a day, and always marked as the last screen until a live frame replaces it.
 * It is never fed into the live caches: a restarted desktop numbers its frames
 * from scratch, and a stale frame there could make live ones look older.
 */
export const LAST_SCREEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A byte transcript past this cannot be kept whole, and a tail cannot be replayed. */
export const LAST_SCREEN_MAX_BYTES_CHARS = 256 * 1024;
export const LAST_SCREEN_GRID_HISTORY_ROWS = 200;

export type LastScreenContent =
  | { kind: 'grid'; frame: NativeTerminalGridState }
  /** Each run keeps the shape it was written at, as the live transcript does. */
  | { kind: 'bytes'; segments: TerminalSegment[] };

export interface LastScreen {
  v: 1;
  savedAtMs: number;
  /** Paired desktop identity: another Mac's screen must never show here. */
  desktopKey: string;
  workspaceLabel: string;
  surfaceLabel: string;
  surfaceKind: SurfaceKind;
  screen: LastScreenContent;
}

export interface LastScreenIdentity {
  desktopKey: string;
  workspaceLabel: string;
  surfaceLabel: string;
  surfaceKind: SurfaceKind;
}

export function desktopKeyOf(profile: { deviceId: string; desktopIdentityPubKey: string }): string {
  return `${profile.deviceId}:${profile.desktopIdentityPubKey}`;
}

export function lastScreenFromGrid(
  identity: LastScreenIdentity,
  frame: NativeTerminalGridState,
  nowMs: number,
): LastScreen {
  return {
    v: 1,
    savedAtMs: nowMs,
    ...identity,
    screen: {
      kind: 'grid',
      frame: {
        ...frame,
        // Only the tail is worth a disk write; the rest is back in seconds.
        omittedLines: frame.omittedLines
          + Math.max(0, frame.historyRows.length - LAST_SCREEN_GRID_HISTORY_ROWS),
        historyRows: frame.historyRows.slice(-LAST_SCREEN_GRID_HISTORY_ROWS),
      },
    },
  };
}

/**
 * A byte transcript starts at a full snapshot, so replaying all of it rebuilds
 * the screen. Too large or without a known shape, it is not kept at all.
 */
export function lastScreenFromTranscript(
  identity: LastScreenIdentity,
  transcript: TerminalTranscriptSnapshot,
  nowMs: number,
): LastScreen | null {
  if (transcript.data.length === 0 || transcript.data.length > LAST_SCREEN_MAX_BYTES_CHARS) return null;
  // Without the shape it starts at, the first run would be parsed at a guess.
  if (transcript.segments[0]?.geometry === undefined) return null;
  return {
    v: 1,
    savedAtMs: nowMs,
    ...identity,
    screen: {
      kind: 'bytes',
      segments: transcript.segments.map((segment) => ({
        data: segment.data,
        ...(segment.geometry === undefined ? {} : { geometry: { ...segment.geometry } }),
      })),
    },
  };
}

export function lastScreenMatches(
  screen: LastScreen | null,
  identity: LastScreenIdentity,
  nowMs: number,
): screen is LastScreen {
  return screen !== null
    && screen.desktopKey === identity.desktopKey
    && screen.workspaceLabel === identity.workspaceLabel
    && screen.surfaceLabel === identity.surfaceLabel
    && screen.surfaceKind === identity.surfaceKind
    && nowMs - screen.savedAtMs >= 0
    && nowMs - screen.savedAtMs <= LAST_SCREEN_MAX_AGE_MS;
}

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);
const isCount = (value: unknown, max: number): value is number => (
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max
);
const isLabel = (value: unknown): value is string => (
  typeof value === 'string' && value.length >= 1 && value.length <= 160
);

function isGridRow(value: unknown): value is TerminalGridRow {
  return isObject(value)
    && typeof value.wrapped === 'boolean'
    && Array.isArray(value.spans)
    && value.spans.every((span) => isObject(span)
      && isCount(span.column, 499)
      && isCount(span.width, 500)
      && typeof span.text === 'string'
      && isObject(span.style));
}

function isGridFrame(value: unknown): value is NativeTerminalGridState {
  return isObject(value)
    && typeof value.panelId === 'string'
    && isCount(value.revision, Number.MAX_SAFE_INTEGER)
    && isCount(value.upperSeq, Number.MAX_SAFE_INTEGER)
    && isCount(value.cols, 500)
    && isCount(value.rows, 200)
    && (value.screen === 'normal' || value.screen === 'alternate')
    && isCount(value.omittedLines, Number.MAX_SAFE_INTEGER)
    && Array.isArray(value.historyRows)
    && value.historyRows.length <= LAST_SCREEN_GRID_HISTORY_ROWS
    && value.historyRows.every(isGridRow)
    && Array.isArray(value.viewportRows)
    && value.viewportRows.length <= 200
    && value.viewportRows.every(isGridRow);
}

/** Whatever is on disk is re-checked: a bad file shows nothing rather than crashing a view. */
export function parseLastScreen(value: unknown): LastScreen | null {
  if (
    !isObject(value)
    || value.v !== 1
    || !isCount(value.savedAtMs, Number.MAX_SAFE_INTEGER)
    || typeof value.desktopKey !== 'string'
    || !isLabel(value.workspaceLabel)
    || !isLabel(value.surfaceLabel)
    || typeof value.surfaceKind !== 'string'
    || !isObject(value.screen)
  ) return null;
  const screen = value.screen;
  if (screen.kind === 'grid') {
    if (!isGridFrame(screen.frame)) return null;
  } else if (screen.kind === 'bytes') {
    if (!Array.isArray(screen.segments) || screen.segments.length === 0) return null;
    let chars = 0;
    for (const segment of screen.segments) {
      if (!isObject(segment) || typeof segment.data !== 'string') return null;
      chars += segment.data.length;
      if (segment.geometry !== undefined && !(
        isObject(segment.geometry)
        && isCount(segment.geometry.cols, 500)
        && isCount(segment.geometry.rows, 200)
      )) return null;
    }
    if (chars > LAST_SCREEN_MAX_BYTES_CHARS) return null;
    if (!isObject((screen.segments[0] as Record<string, unknown>).geometry)) return null;
  } else {
    return null;
  }
  return value as unknown as LastScreen;
}

export interface LastScreenFilePort {
  read(): string | null;
  write(text: string): void;
  remove(): void;
}

/** One file, one screen. Every failure degrades to "nothing to show". */
export class LastScreenStore {
  constructor(private readonly file: LastScreenFilePort) {}

  /** Expired content is deleted here, not merely hidden: "gone after a day" is a promise about the disk. */
  load(nowMs = Date.now()): LastScreen | null {
    try {
      const text = this.file.read();
      if (text === null) return null;
      const parsed = parseLastScreen(JSON.parse(text) as unknown);
      const age = parsed === null ? -1 : nowMs - parsed.savedAtMs;
      if (parsed === null || age < 0 || age > LAST_SCREEN_MAX_AGE_MS) {
        this.clear();
        return null;
      }
      return parsed;
    } catch {
      this.clear();
      return null;
    }
  }

  save(screen: LastScreen): void {
    try {
      this.file.write(JSON.stringify(screen));
    } catch {
      // A cache that cannot be written only means a blank wait next time.
    }
  }

  clear(): void {
    try {
      this.file.remove();
    } catch {
      // Nothing to remove, or nothing that could be.
    }
  }
}
