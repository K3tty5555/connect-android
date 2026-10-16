import * as SecureStore from 'expo-secure-store';
import type { PairedDesktopProfile } from './bridgeClient';
import type { SecureStorePort } from './deviceIdentity';
import { ed25519PublicKeyFromSpki } from './protocolCrypto';

const PROFILE_KEY = 'connect.mobile.paired-desktop.v1';
const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

export interface PairedDesktopLoadResult {
  profile: PairedDesktopProfile | null;
  cleanupReason: 'unsupported_address' | 'invalid_profile' | null;
}

export function isMobileBridgeIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 10
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 100 && b >= 64 && b <= 127)
  );
}

export function validatePairedDesktopProfile(value: unknown): PairedDesktopProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid paired desktop profile');
  }
  const profile = value as Record<string, unknown>;
  const keys = Object.keys(profile);
  if (
    keys.length !== 6
    || !keys.every((key) => [
      'v', 'host', 'port', 'deviceId', 'desktopIdentityPubKey', 'scopes',
    ].includes(key))
    || profile.v !== 1
    || typeof profile.host !== 'string'
    || !isMobileBridgeIpv4(profile.host)
    || !Number.isInteger(profile.port)
    || (profile.port as number) < 1
    || (profile.port as number) > 65_535
    || typeof profile.deviceId !== 'string'
    || !DEVICE_ID_RE.test(profile.deviceId)
    || typeof profile.desktopIdentityPubKey !== 'string'
    || !Array.isArray(profile.scopes)
    || profile.scopes.length < 1
    || profile.scopes.length > 2
    || !profile.scopes.every((scope) => scope === 'read' || scope === 'write')
    || !profile.scopes.includes('read')
    || new Set(profile.scopes).size !== profile.scopes.length
  ) {
    throw new Error('invalid paired desktop profile');
  }
  ed25519PublicKeyFromSpki(profile.desktopIdentityPubKey);
  return profile as unknown as PairedDesktopProfile;
}

export class PairedDesktopStore {
  constructor(private readonly secureStore: SecureStorePort = SecureStore) {}

  async load(): Promise<PairedDesktopProfile | null> {
    return (await this.loadWithStatus()).profile;
  }

  async loadWithStatus(): Promise<PairedDesktopLoadResult> {
    const raw = await this.secureStore.getItemAsync(PROFILE_KEY);
    if (raw === null) return { profile: null, cleanupReason: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
      return { profile: validatePairedDesktopProfile(parsed), cleanupReason: null };
    } catch {
      await this.secureStore.deleteItemAsync(PROFILE_KEY).catch(() => {});
      const host = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).host
        : undefined;
      return {
        profile: null,
        cleanupReason: typeof host === 'string' && !isMobileBridgeIpv4(host)
          ? 'unsupported_address'
          : 'invalid_profile',
      };
    }
  }

  async save(profile: PairedDesktopProfile): Promise<void> {
    const valid = validatePairedDesktopProfile(profile);
    await this.secureStore.setItemAsync(PROFILE_KEY, JSON.stringify(valid));
  }

  async clear(): Promise<void> {
    await this.secureStore.deleteItemAsync(PROFILE_KEY);
  }
}
