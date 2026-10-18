import * as SecureStore from 'expo-secure-store';
import type { SecureStorePort } from './deviceIdentity';

const KEY = 'connect.mobile.pending-relay.v1';
const API_KEY_RE = /^ck_live_[A-Za-z0-9_-]{32,140}$/u;

export interface PendingRelayConfig {
  url: string;
  apiKey: string;
  fallbacks?: Array<{ url: string; apiKey: string }>;
}

function valid(value: unknown): value is PendingRelayConfig {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (Object.keys(value).length === 2 || Object.keys(value).length === 3)
    && typeof (value as Record<string, unknown>).url === 'string'
    && /^wss:\/\//u.test((value as Record<string, unknown>).url as string)
    && ((value as Record<string, unknown>).url as string).length <= 512
    && typeof (value as Record<string, unknown>).apiKey === 'string'
    && API_KEY_RE.test((value as Record<string, unknown>).apiKey as string)
    && (
      (value as Record<string, unknown>).fallbacks === undefined
      || (
        Array.isArray((value as Record<string, unknown>).fallbacks)
        && ((value as Record<string, unknown>).fallbacks as unknown[]).length <= 3
        && ((value as Record<string, unknown>).fallbacks as unknown[]).every((candidate) => (
          typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
          && Object.keys(candidate).length === 2
          && typeof (candidate as Record<string, unknown>).url === 'string'
          && /^wss:\/\//u.test((candidate as Record<string, unknown>).url as string)
          && typeof (candidate as Record<string, unknown>).apiKey === 'string'
          && API_KEY_RE.test((candidate as Record<string, unknown>).apiKey as string)
        ))
      )
    );
}

export class PendingRelayStore {
  constructor(private readonly secureStore: SecureStorePort = SecureStore) {}

  async load(): Promise<PendingRelayConfig | null> {
    const raw = await this.secureStore.getItemAsync(KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!valid(parsed)) throw new Error('invalid pending relay');
      return parsed;
    } catch {
      await this.secureStore.deleteItemAsync(KEY).catch(() => {});
      return null;
    }
  }

  async save(config: PendingRelayConfig): Promise<void> {
    if (!valid(config)) throw new Error('invalid pending relay');
    await this.secureStore.setItemAsync(KEY, JSON.stringify(config));
  }

  async clear(): Promise<void> {
    await this.secureStore.deleteItemAsync(KEY);
  }
}
