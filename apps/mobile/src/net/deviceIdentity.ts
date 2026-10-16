import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { base64ToBytes, bytesToBase64 } from './bytes';
import {
  ed25519PublicKey,
  ed25519PublicKeyToSpki,
  signEd25519,
} from './protocolCrypto';

const PRIVATE_KEY = 'connect.mobile.identity.private.v2';
const PUBLIC_KEY = 'connect.mobile.identity.public.v2';

export type IdentityAccessCode =
  | 'hardware_unavailable'
  | 'identity_missing'
  | 'access_failed';

export type IdentityErrorCategory = 'action_required' | 'permanent';

const SAFE_MESSAGES: Record<IdentityAccessCode, string> = {
  hardware_unavailable: '此设备无法使用系统安全存储。',
  identity_missing: '设备身份已失效，需要重新配对。',
  access_failed: '无法读取设备身份，请检查系统安全设置。',
};

export class IdentityAccessError extends Error {
  readonly category: IdentityErrorCategory;

  constructor(readonly code: IdentityAccessCode) {
    super(SAFE_MESSAGES[code]);
    this.name = 'IdentityAccessError';
    this.category = code === 'identity_missing' || code === 'hardware_unavailable'
      ? 'permanent'
      : 'action_required';
  }
}

export function classifyIdentityAccessError(error: unknown): IdentityAccessError {
  if (error instanceof IdentityAccessError) return error;
  return new IdentityAccessError('access_failed');
}

export interface SecureStoreOptionsPort {
  keychainAccessible?: number;
}

export interface SecureStorePort {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string, options?: SecureStoreOptionsPort): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreOptionsPort): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreOptionsPort): Promise<void>;
}

export interface DeviceIdentityCrypto {
  randomPrivateKey(): Uint8Array;
  publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array;
  sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
}

export interface DeviceIdentityView {
  publicKey: string;
}

interface DeviceIdentityStoreOptions {
  secureStore?: SecureStorePort;
  crypto?: DeviceIdentityCrypto;
  whenPasscodeSetThisDeviceOnly?: number;
}

const defaultCrypto: DeviceIdentityCrypto = {
  randomPrivateKey: () => Crypto.getRandomBytes(32),
  publicKeyFromPrivate: ed25519PublicKey,
  sign: signEd25519,
};

export class DeviceIdentityStore {
  private readonly secureStore: SecureStorePort;
  private readonly crypto: DeviceIdentityCrypto;
  private readonly keychainOptions: SecureStoreOptionsPort;

  constructor(options: DeviceIdentityStoreOptions = {}) {
    this.secureStore = options.secureStore ?? SecureStore;
    this.crypto = options.crypto ?? defaultCrypto;
    this.keychainOptions = {
      keychainAccessible:
        options.whenPasscodeSetThisDeviceOnly ?? SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    };
  }

  async ensureIdentity(): Promise<DeviceIdentityView> {
    const available = await this.secureStore.isAvailableAsync();
    if (!available) throw new IdentityAccessError('hardware_unavailable');
    const existingPublic = await this.secureStore.getItemAsync(PUBLIC_KEY);
    if (existingPublic !== null) return { publicKey: existingPublic };

    let privateKey: Uint8Array | null = null;
    try {
      const existingPrivate = await this.secureStore.getItemAsync(PRIVATE_KEY, this.keychainOptions);
      privateKey = existingPrivate === null
        ? this.crypto.randomPrivateKey()
        : base64ToBytes(existingPrivate);
      if (privateKey.length !== 32) throw new IdentityAccessError('identity_missing');
      const publicKey = ed25519PublicKeyToSpki(this.crypto.publicKeyFromPrivate(privateKey));
      if (existingPrivate === null) {
        await this.secureStore.setItemAsync(
          PRIVATE_KEY,
          bytesToBase64(privateKey),
          this.keychainOptions,
        );
      }
      try {
        await this.secureStore.setItemAsync(PUBLIC_KEY, publicKey);
      } catch (error) {
        if (existingPrivate === null) {
          await this.secureStore.deleteItemAsync(PRIVATE_KEY, this.keychainOptions).catch(() => {});
        }
        throw error;
      }
      return { publicKey };
    } catch (error) {
      throw classifyIdentityAccessError(error);
    } finally {
      privateKey?.fill(0);
    }
  }

  async sign(message: Uint8Array): Promise<string> {
    let privateKey: Uint8Array | null = null;
    try {
      const encoded = await this.secureStore.getItemAsync(PRIVATE_KEY, this.keychainOptions);
      if (encoded === null) throw new IdentityAccessError('identity_missing');
      privateKey = base64ToBytes(encoded);
      if (privateKey.length !== 32) throw new IdentityAccessError('identity_missing');
      return bytesToBase64(this.crypto.sign(message, privateKey));
    } catch (error) {
      throw classifyIdentityAccessError(error);
    } finally {
      privateKey?.fill(0);
    }
  }

  async clear(): Promise<void> {
    await this.secureStore.deleteItemAsync(PUBLIC_KEY);
    await this.secureStore.deleteItemAsync(PRIVATE_KEY, this.keychainOptions);
  }
}
