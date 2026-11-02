import { Platform } from 'react-native';
import mobilePackage from '../../package.json';
import { parseCrashReportUrl } from '../../../../src/shared/crashReport';
import type { CrashContext } from './jsFatalHandler';

export function mobileCrashContext(): CrashContext {
  return {
    appVersion: (process.env.EXPO_PUBLIC_CONNECT_VERSION || mobilePackage.version).slice(0, 64),
    platform: Platform.OS,
    osRelease: String(Platform.Version).slice(0, 64),
  };
}

/** Build-time address from config/crash-report.json (app.config.js); null hides the send button. */
export function mobileCrashUploadUrl(): string | null {
  return parseCrashReportUrl(
    process.env.EXPO_PUBLIC_CONNECT_CRASH_REPORT_URL,
    process.env.EXPO_PUBLIC_CONNECT_CRASH_REPORT_HOSTS,
  );
}
