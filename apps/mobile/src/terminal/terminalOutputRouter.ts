import type { TerminalGeometry, TerminalSegment } from './terminalSegments';
import type { TerminalTranscriptCache } from './terminalTranscriptCache';
import type { TerminalGeometryGuard } from './terminalGeometryGuard';

interface LiveTerminalWriter {
  write(data: string, geometry?: TerminalGeometry, renderOperationId?: string): void;
  replace(
    data: string | readonly TerminalSegment[],
    restore?: { trimmedLines?: number },
  ): void;
}

export interface DeliverTerminalOutputOptions {
  activePanelId: string | null;
  cache: TerminalTranscriptCache;
  data: string;
  geometry?: TerminalGeometry;
  panelId: string;
  terminal: LiveTerminalWriter | null;
  renderOperationId?: string;
  geometryGuard?: TerminalGeometryGuard;
  sequence?: number;
}

export interface TerminalOutputDelivery {
  cacheRetained: boolean;
  presented: boolean;
  recoveryRequired?: true;
}

export interface DeliverTerminalSnapshotOptions {
  activePanelId: string | null;
  cache: TerminalTranscriptCache;
  data: string;
  geometry: TerminalGeometry;
  panelId: string;
  terminal: LiveTerminalWriter | null;
  trimmedLines?: number;
  geometryGuard?: TerminalGeometryGuard;
  sequence?: number;
}

export interface DeliverTerminalHistoryOptions {
  activePanelId: string | null;
  cache: TerminalTranscriptCache;
  panelId: string;
  segments: readonly TerminalSegment[];
  terminal: LiveTerminalWriter | null;
  trimmedLines?: number;
  geometryGuard?: TerminalGeometryGuard;
  sequence?: number;
}

/** Presents an authoritative snapshot even when it is too large for the remount cache. */
export function deliverTerminalSnapshot({
  activePanelId,
  cache,
  data,
  geometry,
  geometryGuard,
  panelId,
  terminal,
  trimmedLines = 0,
  sequence,
}: DeliverTerminalSnapshotOptions): TerminalOutputDelivery {
  if (geometryGuard?.replace(panelId, geometry, sequence) === false) {
    return { cacheRetained: false, presented: false };
  }
  const cacheRetained = cache.replaceSnapshot(panelId, data, geometry, trimmedLines);
  const presented = activePanelId === panelId && terminal !== null;
  if (presented) terminal.replace([{ data, geometry }], { trimmedLines });
  return { cacheRetained, presented };
}

/** Atomically enriches the viewport with history plus every retained live increment. */
export function deliverTerminalHistory({
  activePanelId,
  cache,
  panelId,
  segments,
  terminal,
  trimmedLines = 0,
  geometryGuard,
  sequence,
}: DeliverTerminalHistoryOptions): TerminalOutputDelivery {
  let historyGeometry: TerminalGeometry | undefined;
  for (const segment of segments) {
    if (segment.geometry === undefined) continue;
    if (historyGeometry === undefined) historyGeometry = segment.geometry;
    else if (
      historyGeometry.cols !== segment.geometry.cols
      || historyGeometry.rows !== segment.geometry.rows
    ) {
      return { cacheRetained: false, presented: false, recoveryRequired: true };
    }
  }
  if (
    historyGeometry !== undefined
    && geometryGuard?.replace(panelId, historyGeometry, sequence) === false
  ) {
    return { cacheRetained: false, presented: false };
  }
  const cacheRetained = cache.replaceSnapshotSegments(panelId, segments, trimmedLines);
  const presented = activePanelId === panelId && terminal !== null;
  if (presented) terminal.replace(segments, { trimmedLines });
  return { cacheRetained, presented };
}

/** Keeps live xterm delivery independent from the bounded remount cache. */
export function deliverTerminalOutput({
  activePanelId,
  cache,
  data,
  geometry,
  geometryGuard,
  panelId,
  terminal,
  renderOperationId,
  sequence,
}: DeliverTerminalOutputOptions): TerminalOutputDelivery {
  const disposition = geometryGuard?.observe(panelId, geometry, sequence) ?? 'accept';
  if (disposition !== 'accept') {
    if (disposition === 'recover') cache.invalidate(panelId);
    return {
      cacheRetained: false,
      presented: false,
      ...(disposition === 'recover' ? { recoveryRequired: true as const } : {}),
    };
  }
  const cacheRetained = cache.append(panelId, data, geometry);
  const presented = activePanelId === panelId && terminal !== null;
  if (presented) {
    if (renderOperationId === undefined) terminal.write(data, geometry);
    else terminal.write(data, geometry, renderOperationId);
  }
  return { cacheRetained, presented };
}
