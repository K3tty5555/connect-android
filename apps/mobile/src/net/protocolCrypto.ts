import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  equalBytes,
  textToBytes,
  uint32be,
} from './bytes';

const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
const X25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x03, 0x21, 0x00,
]);

const PAIRING_INFO = textToBytes('connect:mobile-bridge:pairing:v1');
const CONFIRM_INFO = textToBytes('connect:mobile-bridge:pairing-confirm:v1');
const SAS_INFO = textToBytes('connect:mobile-bridge:sas:v1');
const TRANSCRIPT_DOMAIN = textToBytes('connect:mobile-bridge:transcript:v1');
const DESKTOP_TO_PHONE_INFO = textToBytes('connect:mobile-bridge:session:d2p:v1');
const PHONE_TO_DESKTOP_INFO = textToBytes('connect:mobile-bridge:session:p2d:v1');

export interface RawKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface MobileSessionKeys {
  sendKey: Uint8Array;
  receiveKey: Uint8Array;
}

export function counterIv(counter: number): Uint8Array {
  if (!Number.isSafeInteger(counter) || counter < 1) throw new Error('invalid frame counter');
  const iv = new Uint8Array(12);
  const view = new DataView(iv.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32), false);
  view.setUint32(4, counter >>> 0, false);
  return iv;
}

function wrapSpki(prefix: Uint8Array, raw: Uint8Array): string {
  if (raw.length !== 32) throw new Error('public key must be 32 bytes');
  return bytesToBase64(concatBytes(prefix, raw));
}

function unwrapSpki(value: string, prefix: Uint8Array): Uint8Array {
  const der = base64ToBytes(value);
  if (der.length !== prefix.length + 32 || !equalBytes(der.subarray(0, prefix.length), prefix)) {
    throw new Error('invalid public key encoding');
  }
  return der.slice(prefix.length);
}

export function ed25519PublicKeyToSpki(publicKey: Uint8Array): string {
  return wrapSpki(ED25519_SPKI_PREFIX, publicKey);
}

export function ed25519PublicKeyFromSpki(value: string): Uint8Array {
  return unwrapSpki(value, ED25519_SPKI_PREFIX);
}

export function x25519PublicKeyToSpki(publicKey: Uint8Array): string {
  return wrapSpki(X25519_SPKI_PREFIX, publicKey);
}

export function x25519PublicKeyFromSpki(value: string): Uint8Array {
  return unwrapSpki(value, X25519_SPKI_PREFIX);
}

export function ed25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

export function signEd25519(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

export function verifyEd25519(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

export function generateX25519KeyPair(randomPrivateKey: () => Uint8Array): RawKeyPair {
  const privateKey = randomPrivateKey();
  if (privateKey.length !== 32) throw new Error('x25519 private key must be 32 bytes');
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function derivePairingKey(
  privateKey: Uint8Array,
  desktopPublicKeySpki: string,
  pairingCode: string,
): Uint8Array {
  if (!/^\d{6}$/u.test(pairingCode)) throw new Error('pairing code must be six digits');
  const shared = x25519.getSharedSecret(privateKey, x25519PublicKeyFromSpki(desktopPublicKeySpki));
  try {
    return hkdf(sha256, shared, textToBytes(pairingCode), PAIRING_INFO, 32);
  } finally {
    shared.fill(0);
  }
}

export function computePairingConfirmation(
  pairingKey: Uint8Array,
  input: { deviceName: string; identityPubKey: string; ephemeralPubKey: string },
): string {
  const parts = [
    CONFIRM_INFO,
    textToBytes(input.deviceName),
    base64ToBytes(input.identityPubKey),
    base64ToBytes(input.ephemeralPubKey),
  ];
  const payload = concatBytes(
    parts[0]!,
    ...parts.slice(1).flatMap((part) => [uint32be(part.length), part]),
  );
  return bytesToBase64(hmac(sha256, pairingKey, payload));
}

export function computeSas(pairingKey: Uint8Array): string {
  const digest = hkdf(sha256, pairingKey, new Uint8Array(), SAS_INFO, 4);
  const value = new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getUint32(0, false);
  return String(value % 1_000_000).padStart(6, '0');
}

export function buildTranscript(input: {
  deviceId: string;
  phoneEphemeralPubKey: string;
  desktopEphemeralPubKey: string;
  nonce: Uint8Array;
}): Uint8Array {
  const parts = [
    TRANSCRIPT_DOMAIN,
    textToBytes(input.deviceId),
    base64ToBytes(input.phoneEphemeralPubKey),
    base64ToBytes(input.desktopEphemeralPubKey),
    input.nonce,
  ];
  return concatBytes(...parts.flatMap((part) => [uint32be(part.length), part]));
}

export function deriveSessionKeys(input: {
  phonePrivateKey: Uint8Array;
  desktopPublicKeySpki: string;
  transcript: Uint8Array;
}): MobileSessionKeys {
  const shared = x25519.getSharedSecret(
    input.phonePrivateKey,
    x25519PublicKeyFromSpki(input.desktopPublicKeySpki),
  );
  try {
    return {
      sendKey: hkdf(sha256, shared, input.transcript, PHONE_TO_DESKTOP_INFO, 32),
      receiveKey: hkdf(sha256, shared, input.transcript, DESKTOP_TO_PHONE_INFO, 32),
    };
  } finally {
    shared.fill(0);
  }
}
