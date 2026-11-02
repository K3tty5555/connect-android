import type { CrashLogEntry, CrashLogEntryKind, CrashReport, CrashReportPlatform, CrashReportSendResult } from './types.js';

/**
 * 崩溃记录的读取、组报告与上传（ADR-008），桌面主进程与手机共用的纯逻辑。
 * 本机 crash.log 是 JSONL；读出时逐行按契约白名单重建字段并截断，旧版本或损坏的行
 * 也不会带出契约外的内容。预览给用户看的就是将要发送的原文，一字不差。
 */

export type { CrashReportSendResult } from './types.js';

export const CRASH_REPORT_MAX_ENTRIES = 10;
/** 低于服务器 Nginx 的 64 KB 上限，给请求头留余量。 */
export const CRASH_REPORT_MAX_BYTES = 60 * 1024;

const KINDS: ReadonlySet<CrashLogEntryKind> = new Set<CrashLogEntryKind>([
  'render-process-gone', 'child-process-gone', 'uncaught-exception',
  'js-fatal', 'previous-exit', 'native-crash',
]);
const LABEL_KEYS = ['surface', 'reason', 'processType', 'serviceName', 'name', 'origin', 'errorName', 'code'] as const;
const SHORT_KEYS = { appVersion: 64, platform: 16, arch: 16, electron: 32, osRelease: 64 } as const;
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function sanitizeCrashLogEntry(value: unknown): CrashLogEntry | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw['at'] !== 'string' || raw['at'].length === 0) return null;
  if (typeof raw['kind'] !== 'string' || !KINDS.has(raw['kind'] as CrashLogEntryKind)) return null;
  const entry: CrashLogEntry = { at: raw['at'].slice(0, 40), kind: raw['kind'] as CrashLogEntryKind };
  for (const key of LABEL_KEYS) {
    const field = raw[key];
    if (typeof field === 'string') entry[key] = field.slice(0, 120);
  }
  for (const [key, max] of Object.entries(SHORT_KEYS) as [keyof typeof SHORT_KEYS, number][]) {
    const field = raw[key];
    if (typeof field === 'string') entry[key] = field.slice(0, max);
  }
  if (Number.isInteger(raw['exitCode'])) entry.exitCode = raw['exitCode'] as number;
  if (typeof raw['message'] === 'string') entry.message = raw['message'].slice(0, 500);
  if (Array.isArray(raw['frames'])) {
    entry.frames = raw['frames']
      .filter((frame): frame is string => typeof frame === 'string')
      .slice(0, 15)
      .map((frame) => frame.slice(0, 300));
  }
  return entry;
}

/** 读 JSONL 文本（可传入多份，按旧到新的顺序），丢弃无法识别的行。 */
export function parseCrashLog(...texts: string[]): CrashLogEntry[] {
  const entries: CrashLogEntry[] = [];
  for (const text of texts) {
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      const entry = sanitizeCrashLogEntry(parsed);
      if (entry !== null) entries.push(entry);
    }
  }
  return entries;
}

/** 取最新的若干条组成报告；超出体积上限时从最旧的开始丢。没有可发的条目返回 null。 */
export function buildCrashReport(input: {
  reportId: string;
  platform: CrashReportPlatform;
  appVersion: string;
  entries: readonly CrashLogEntry[];
}): CrashReport | null {
  if (!REPORT_ID.test(input.reportId)) throw new Error('invalid crash report id');
  const entries = input.entries.slice(-CRASH_REPORT_MAX_ENTRIES);
  while (entries.length > 0) {
    const report: CrashReport = {
      schemaVersion: 1,
      reportId: input.reportId,
      platform: input.platform,
      appVersion: input.appVersion.slice(0, 64) || 'unknown',
      entries,
    };
    if (utf8Length(serializeCrashReport(report)) <= CRASH_REPORT_MAX_BYTES) return report;
    entries.shift();
  }
  return null;
}

/**
 * 「已发送」指纹：报告里最新一条记录的时间、类型与原因（ADR-008 修订 2026-11-01）。
 * 发送成功后本机保存；之后最新一条不变就视为已发送，出现新崩溃才可再发。
 */
export function crashReportSentKey(report: CrashReport): string {
  const newest = report.entries[report.entries.length - 1];
  return [newest?.at ?? '', newest?.kind ?? '', newest?.reason ?? '', newest?.errorName ?? ''].join('|');
}

/** 预览与上传共用同一份文本。 */
export function serializeCrashReport(report: CrashReport): string {
  return JSON.stringify(report, null, 2);
}

export interface CrashReportFetch {
  (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<{
    status: number;
  }>;
}

export async function sendCrashReport(
  fetchImpl: CrashReportFetch,
  url: string,
  report: CrashReport,
  timeoutMs = 15_000,
): Promise<CrashReportSendResult> {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller === null ? null : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serializeCrashReport(report),
      ...(controller === null ? {} : { signal: controller.signal }),
    });
    if (response.status === 201 || response.status === 200) return { ok: true, reportId: report.reportId };
    if (response.status === 429) return { ok: false, code: 'rate_limited' };
    if (response.status >= 400 && response.status < 500) return { ok: false, code: 'rejected' };
    return { ok: false, code: 'server' };
  } catch {
    return { ok: false, code: 'network' };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** 构建期注入的上传地址：只接受 https、无端口/凭据/查询，主机须在白名单里；否则视为未配置。 */
export function parseCrashReportUrl(url: string | undefined, allowedHosts: string | undefined): string | null {
  if (url === undefined || url.trim() === '') return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
  if (parsed.search || parsed.hash) return null;
  const hosts = (allowedHosts ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!hosts.includes(parsed.hostname.toLowerCase())) return null;
  return parsed.href;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i += 1; }
    else bytes += 3;
  }
  return bytes;
}
