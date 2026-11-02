import { Share } from 'react-native';
import {
  buildCrashReport,
  crashReportSentKey,
  sendCrashReport,
  serializeCrashReport,
  type CrashReportFetch,
} from '../../../../src/shared/crashReport';
import type { CrashLogEntry, CrashReport, CrashReportSendResult } from '../../../../src/shared/types';

/**
 * What the Settings page needs to show and hand over the crash log (ADR-008):
 * the preview and the upload use one serialized text, and nothing leaves the
 * phone unless the user taps send or share.
 */
export interface CrashDiagnostics {
  /** False when this build has no valid upload address; sharing still works. */
  readonly canSend: boolean;
  entries(): CrashLogEntry[];
  /** A fresh random report id each time; null when nothing can be reported. */
  createReport(): CrashReport | null;
  /** The newest record in this report was already sent successfully (ADR-008 revision 2026-11-01). */
  isSent(report: CrashReport): boolean;
  /** Refuses (as `rejected`) a report whose newest record was already sent; remembers a successful send. */
  send(report: CrashReport): Promise<CrashReportSendResult>;
  /** `anchor` is the share button's native handle, used as the iPad popover anchor. */
  share(report: CrashReport, anchor?: number): Promise<void>;
}

export function createCrashDiagnostics(deps: {
  readEntries(): CrashLogEntry[];
  platform: 'ios' | 'android';
  appVersion: string;
  uploadUrl: string | null;
  randomId(): string;
  fetchImpl?: CrashReportFetch;
  share?(message: string, anchor?: number): Promise<unknown>;
  /** Where the last successful send's fingerprint is kept (document directory). */
  sentMarker?: { read(): string | null; write(key: string): void };
}): CrashDiagnostics {
  const isSent = (report: CrashReport): boolean => {
    try {
      return deps.sentMarker?.read() === crashReportSentKey(report);
    } catch {
      return false;
    }
  };
  const entries = (): CrashLogEntry[] => {
    try {
      return deps.readEntries();
    } catch {
      return [];
    }
  };
  return {
    canSend: deps.uploadUrl !== null,
    entries,
    createReport: () => {
      try {
        return buildCrashReport({
          reportId: deps.randomId(),
          platform: deps.platform,
          appVersion: deps.appVersion,
          entries: entries(),
        });
      } catch {
        return null;
      }
    },
    isSent,
    send: async (report) => {
      if (deps.uploadUrl === null || isSent(report)) return { ok: false, code: 'rejected' };
      const fetchImpl: CrashReportFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
      const result = await sendCrashReport(fetchImpl, deps.uploadUrl, report);
      if (result.ok) {
        try {
          deps.sentMarker?.write(crashReportSentKey(report));
        } catch {
          // Worst case the same records can be sent once more.
        }
      }
      return result;
    },
    share: async (report, anchor) => {
      const message = serializeCrashReport(report);
      try {
        await (deps.share
          ? deps.share(message, anchor)
          : Share.share({ message }, anchor === undefined ? undefined : { anchor }));
      } catch {
        // Dismissed or unavailable: nothing to report back.
      }
    },
  };
}
