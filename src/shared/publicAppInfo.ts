import type { PublicAppInfo, PublicLinkKind } from './types.js';

export const PUBLIC_LINK_KINDS = [
  'macDownload',
  'androidDownload',
  'iosAppStore',
  'privacy',
  'support',
  'compatibility',
] as const satisfies readonly PublicLinkKind[];

export interface PublicAppInfoBuildInput {
  allowedHosts?: string | null;
  macDownloadUrl?: string | null;
  androidDownloadUrl?: string | null;
  iosAppStoreUrl?: string | null;
  privacyUrl?: string | null;
  supportUrl?: string | null;
  compatibilityUrl?: string | null;
}

const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/u;

export function parseAllowedHosts(raw: string | null | undefined): Set<string> {
  const hosts = (raw ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length > 8 || new Set(hosts).size !== hosts.length) {
    throw new Error('invalid public link allowlist');
  }
  for (const host of hosts) {
    if (!HOST_PATTERN.test(host)) throw new Error('invalid public link allowlist');
  }
  return new Set(hosts);
}

/** Normalized HTTPS link on an allowlisted host, null when unset; throws otherwise. Shared with the preload boundary. */
export function publicUrl(
  kind: PublicLinkKind,
  raw: string | null | undefined,
  allowedHosts: ReadonlySet<string>,
): string | null {
  const value = raw?.trim() ?? '';
  if (!value) return null;
  if (value.length > 2048) throw new Error(`invalid public link: ${kind}`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`invalid public link: ${kind}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:'
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.port !== ''
    || parsed.search !== ''
    || parsed.hash !== ''
    || !allowedHosts.has(host)
    || (kind === 'iosAppStore' && (host !== 'apps.apple.com' || !/\/app\//u.test(parsed.pathname)))
  ) {
    throw new Error(`invalid public link: ${kind}`);
  }
  return parsed.toString();
}

export function buildPublicAppInfo(
  version: string,
  input: PublicAppInfoBuildInput,
): PublicAppInfo {
  if (!/^\d+\.\d+\.\d+$/u.test(version) || version.length > 32) {
    throw new Error('invalid public app version');
  }
  const allowedHosts = parseAllowedHosts(input.allowedHosts);
  return {
    schemaVersion: 1,
    version,
    links: {
      macDownload: publicUrl('macDownload', input.macDownloadUrl, allowedHosts),
      androidDownload: publicUrl('androidDownload', input.androidDownloadUrl, allowedHosts),
      iosAppStore: publicUrl('iosAppStore', input.iosAppStoreUrl, allowedHosts),
      privacy: publicUrl('privacy', input.privacyUrl, allowedHosts),
      support: publicUrl('support', input.supportUrl, allowedHosts),
      compatibility: publicUrl('compatibility', input.compatibilityUrl, allowedHosts),
    },
  };
}

export function isPublicLinkKind(value: unknown): value is PublicLinkKind {
  return typeof value === 'string'
    && (PUBLIC_LINK_KINDS as readonly string[]).includes(value);
}
