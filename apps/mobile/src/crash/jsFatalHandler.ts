import type { CrashLogEntry } from '../../../../src/shared/types';

/** The slice of React Native's global `ErrorUtils` this module touches. */
export interface GlobalErrorUtils {
  getGlobalHandler(): ((error: unknown, isFatal?: boolean) => void) | null | undefined;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

export interface CrashContext {
  appVersion: string;
  platform: string;
  osRelease: string;
}

// The contract's bounds (contracts/crash-report.schema.json), so a line can go into a report as is.
const MAX_MESSAGE = 500;
const MAX_FRAMES = 15;
const MAX_FRAME = 300;
const MAX_LABEL = 120;

const URL_TOKEN = /[a-z][a-z0-9+.-]*:\/\/[^\s)]+/giu;
/** V8 / Hermes JSON errors can quote the input, which may be terminal or model output. */
const JSON_SNIPPET = /, (?:\.\.\.)?".*"(?:\.\.\.)? is not valid JSON/gu;
/** Bare IPv4 (with port), e.g. `ECONNREFUSED 100.64.1.2:8787`: a Tailscale or LAN address is close to a device id. */
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/gu;
/** Tailscale MagicDNS names (`my-mac.tail1234.ts.net`) are close to a device id too. */
const TAILNET_HOST = /\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b/giu;

/** One bounded line with URLs, IPs, tailnet names and quoted JSON input replaced; shared with previous-exit descriptions. */
export function redactMessage(text: string): string {
  return text
    .replace(/\s*\n\s*/gu, ' | ')
    .replace(JSON_SNIPPET, ', <input> is not valid JSON')
    .replace(URL_TOKEN, '<url>')
    .replace(TAILNET_HOST, '<host>')
    .replace(IPV4, '<ip>')
    .slice(0, MAX_MESSAGE);
}
/** JSC / old-RN frames: `name@file:line:col`. */
const AT_SIGN_FRAME = /^[^\s@]*@\S+:\d+(?::\d+)?$/u;

/**
 * Release builds die on an uncaught JavaScript error and leave nothing behind
 * (ADR-008). This records fatal ones, then always hands the error to the
 * handler that was there before, so the App behaves exactly as it did.
 * Non-fatal errors are not recorded: they are noise next to real crashes.
 */
export function installJsFatalHandler(deps: {
  errorUtils: GlobalErrorUtils | undefined;
  record(entry: CrashLogEntry): void;
  context: CrashContext;
  now?: () => Date;
}): void {
  try {
    const errorUtils = deps.errorUtils;
    if (!errorUtils) return;
    const previous = errorUtils.getGlobalHandler();
    const now = deps.now ?? (() => new Date());
    errorUtils.setGlobalHandler((error, isFatal) => {
      if (isFatal === true) {
        try {
          deps.record(describeJsFatal(error, deps.context, now));
        } catch {
          // Recording must never change how the App fails.
        }
      }
      previous?.(error, isFatal);
    });
  } catch {
    // Without ErrorUtils there is nothing to wrap.
  }
}

/**
 * Error name, a single-line bounded message and stack frames — never the thrown
 * value itself when it is not an Error, and no URLs (a message can carry one
 * with a token in it; a frame keeps only the file name).
 */
export function describeJsFatal(error: unknown, context: CrashContext, now: () => Date): CrashLogEntry {
  const base: CrashLogEntry = { at: now().toISOString(), kind: 'js-fatal', origin: 'fatal' };
  if (!(error instanceof Error)) {
    return { ...base, errorName: error === null ? 'null' : typeof error, ...context };
  }
  const frames = (typeof error.stack === 'string' ? error.stack : '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') || AT_SIGN_FRAME.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => line.replace(URL_TOKEN, fileName).slice(0, MAX_FRAME));
  const message = redactMessage(String(error.message));
  return {
    ...base,
    errorName: String(error.name).slice(0, MAX_LABEL),
    message,
    frames,
    ...context,
  };
}

/** `http://host:8081/index.bundle?platform=ios:12:34` → `index.bundle:12:34`. */
function fileName(url: string): string {
  const withoutQuery = url.replace(/[?#][^:\s)]*/u, '');
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
}
