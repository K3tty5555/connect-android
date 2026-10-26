import * as SecureStore from 'expo-secure-store';
import type { PairedDesktopProfile } from './bridgeClient';
import type { SecureStorePort } from './deviceIdentity';
import { ed25519PublicKeyFromSpki } from './protocolCrypto';
import { isRelayOnlyPairingHost } from '../../../../src/shared/mobilePairingQrBoundary';

const PROFILE_KEY = 'connect.mobile.paired-desktop.v1';
/**
 * ADR-003 §17 回退候选：桌面换址前的那组 host:port，至多一组。单独存一个键而不是给档案加字段——
 * 档案校验按精确键集合，加字段会让降级回旧版的手机把整份配对当非法删掉。
 */
const FALLBACK_KEY = 'connect.mobile.paired-desktop.fallback.v1';
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

export interface DesktopEndpoint {
  host: string;
  port: number;
}

/** 绑定到哪台已配对桌面：与 L3 验签所用的身份一致。 */
export interface DesktopBinding {
  deviceId: string;
  desktopIdentityPubKey: string;
}

/** 桌面经已认证会话告知的地址：必须是真实 Tailscale / RFC1918 IPv4（占位地址不行）与合法端口。 */
export function isAcceptableDesktopEndpoint(value: unknown): value is DesktopEndpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const endpoint = value as Record<string, unknown>;
  return Object.keys(endpoint).length === 2
    && typeof endpoint.host === 'string'
    && isMobileBridgeIpv4(endpoint.host)
    && Number.isInteger(endpoint.port)
    && (endpoint.port as number) >= 1
    && (endpoint.port as number) <= 65_535;
}

function sameBinding(a: DesktopBinding, b: DesktopBinding): boolean {
  return a.deviceId === b.deviceId && a.desktopIdentityPubKey === b.desktopIdentityPubKey;
}

export function validatePairedDesktopProfile(value: unknown): PairedDesktopProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('invalid paired desktop profile');
  }
  const profile = value as Record<string, unknown>;
  const keys = Object.keys(profile);
  const relay = profile.relay;
  const relayRecord = typeof relay === 'object' && relay !== null && !Array.isArray(relay)
    ? relay as Record<string, unknown>
    : null;
  const relayFallbacks = relayRecord?.fallbacks;
  const relayValid = relay === undefined || (
    relayRecord !== null
    && (Object.keys(relayRecord).length >= 3 && Object.keys(relayRecord).length <= 5)
    && typeof relayRecord.url === 'string'
    && /^wss:\/\//u.test(relayRecord.url)
    && relayRecord.url.length <= 512
    && typeof relayRecord.ticket === 'string'
    && /^rt_[A-Za-z0-9_-]{24,96}$/u.test(relayRecord.ticket)
    && typeof relayRecord.apiKey === 'string'
    && /^ck_live_[A-Za-z0-9_-]{32,140}$/u.test(relayRecord.apiKey)
    && (relayRecord.credential === undefined
      || (typeof relayRecord.credential === 'string' && /^rc_[A-Za-z0-9_-]{32,160}$/u.test(relayRecord.credential)))
    && (
      relayFallbacks === undefined
      || (
        Array.isArray(relayFallbacks)
        && relayFallbacks.length <= 3
        && relayFallbacks.every((candidate: unknown) => (
          typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
          && Object.keys(candidate).length === 2
          && typeof (candidate as Record<string, unknown>).url === 'string'
          && /^wss:\/\//u.test((candidate as Record<string, unknown>).url as string)
          && ((candidate as Record<string, unknown>).url as string).length <= 512
          && typeof (candidate as Record<string, unknown>).apiKey === 'string'
          && /^ck_live_[A-Za-z0-9_-]{32,140}$/u.test((candidate as Record<string, unknown>).apiKey as string)
        ))
      )
    )
  );
  if (
    (keys.length !== 6 && keys.length !== 7)
    || !keys.every((key) => [
      'v', 'host', 'port', 'deviceId', 'desktopIdentityPubKey', 'scopes',
      'relay',
    ].includes(key))
    || profile.v !== 1
    || typeof profile.host !== 'string'
    || (!isMobileBridgeIpv4(profile.host)
      && !(relay !== undefined && isRelayOnlyPairingHost(profile.host)))
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
    || !relayValid
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
    await this.secureStore.deleteItemAsync(FALLBACK_KEY);
  }

  /**
   * ADR-003 §17：采纳桌面告知的新直连地址。只改 host 与 port；deviceId、桌面公钥、scope、Relay
   * 一概不动。只在档案仍是同一台桌面时生效，旧的真实地址留作回退候选。返回 null 表示没有改动。
   */
  async updateEndpoint(binding: DesktopBinding, endpoint: DesktopEndpoint): Promise<PairedDesktopProfile | null> {
    if (!isAcceptableDesktopEndpoint(endpoint)) return null;
    const current = await this.load();
    if (current === null || !sameBinding(current, binding)) return null;
    if (current.host === endpoint.host && current.port === endpoint.port) return null;
    const next: PairedDesktopProfile = { ...current, host: endpoint.host, port: endpoint.port };
    await this.save(next);
    const previous = { host: current.host, port: current.port };
    // Relay-only 档案的占位地址不是可拨的地址，不留作回退
    if (isAcceptableDesktopEndpoint(previous)) {
      await this.secureStore.setItemAsync(FALLBACK_KEY, JSON.stringify({ ...binding, ...previous }));
    } else {
      await this.secureStore.deleteItemAsync(FALLBACK_KEY);
    }
    return next;
  }

  /** 回退候选；不属于这台桌面、格式不对或与当前地址相同都视为没有。 */
  async loadFallback(profile: PairedDesktopProfile): Promise<DesktopEndpoint | null> {
    // 回退地址只是锦上添花：读不出来（钥匙串暂不可用等）就当没有，不能挡住连接本身。
    let raw: string | null;
    try {
      raw = await this.secureStore.getItemAsync(FALLBACK_KEY);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const endpoint = { host: parsed.host, port: parsed.port };
      if (
        Object.keys(parsed).length === 4
        && parsed.deviceId === profile.deviceId
        && parsed.desktopIdentityPubKey === profile.desktopIdentityPubKey
        && isAcceptableDesktopEndpoint(endpoint)
        && !(endpoint.host === profile.host && endpoint.port === profile.port)
      ) return endpoint;
    } catch {
      // 落到下面一并清掉
    }
    await this.secureStore.deleteItemAsync(FALLBACK_KEY).catch(() => {});
    return null;
  }

  /** 新地址经 L3 认证成功一次后丢弃回退候选。 */
  async clearFallback(): Promise<void> {
    await this.secureStore.deleteItemAsync(FALLBACK_KEY);
  }

  /**
   * 设置页改 Relay 地址 / Key：沿用配对时拿到的设备凭据和备用端点（2026-10-20）。此前直接整体替换，
   * 凭据和备用 Relay 一起丢了，手机只能拿 API Key 加入。
   */
  async updateRelayEndpoint(
    endpoint: { url: string; apiKey: string },
    ticket: string,
  ): Promise<PairedDesktopProfile> {
    const current = await this.load();
    if (!current) throw new Error('no paired desktop');
    return this.setRelay({
      url: endpoint.url,
      apiKey: endpoint.apiKey,
      ticket,
      ...(current.relay?.credential ? { credential: current.relay.credential } : {}),
      ...(current.relay?.fallbacks ? { fallbacks: current.relay.fallbacks } : {}),
    });
  }

  async setRelay(relay: NonNullable<PairedDesktopProfile['relay']> | null): Promise<PairedDesktopProfile> {
    const current = await this.load();
    if (!current) throw new Error('no paired desktop');
    const next = relay === null ? { ...current, relay: undefined } : { ...current, relay };
    if (relay === null) delete (next as { relay?: unknown }).relay;
    await this.save(next);
    return next;
  }
}
