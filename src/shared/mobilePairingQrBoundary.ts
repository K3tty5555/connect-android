import type { MobilePairingQr } from './types.js';

/** Metadata used when Relay is the only transport and no local bridge socket exists. */
export const RELAY_ONLY_PAIRING_HOST = '192.0.2.1';

export function isRelayOnlyPairingHost(value: string): boolean {
  return value === RELAY_ONLY_PAIRING_HOST;
}

export type MobilePairingQrValidationResult =
  | { ok: true; value: MobilePairingQr }
  | { ok: false; errors: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function validRelay(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['url', 'ticket'])) return false;
  return (
    Object.keys(value).length === 2
    && typeof value.url === 'string'
    && /^wss:\/\//u.test(value.url)
    && value.url.length <= 512
    && typeof value.ticket === 'string'
    && /^rt_[A-Za-z0-9_-]{24,96}$/u.test(value.ticket)
  );
}

/** Preload-safe projection of mobile-pairing-qr.schema.json; it must not import Node or AJV. */
export function validateMobilePairingQrBoundary(value: unknown): MobilePairingQrValidationResult {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'v',
    'host',
    'port',
    'pairingCode',
    'desktopEphemeralPubKey',
    'desktopIdentityPubKey',
    'issuedAtMs',
    'expiresInMs',
    'relay',
  ])) {
    return { ok: false, errors: 'invalid MobilePairingQr' };
  }

  const relayValue = value.relay;
  const relayOnlyHost = typeof value.host === 'string'
    && isRelayOnlyPairingHost(value.host)
    && relayValue !== undefined;
  if (
    value.v !== 2
    || typeof value.host !== 'string'
    || !/^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/u.test(value.host)
    || (relayOnlyHost === false && value.host === RELAY_ONLY_PAIRING_HOST)
    || value.host.length > 255
    || typeof value.port !== 'number'
    || !Number.isInteger(value.port)
    || value.port < 1
    || value.port > 65535
    || typeof value.pairingCode !== 'string'
    || !/^[0-9]{6}$/u.test(value.pairingCode)
    || typeof value.desktopEphemeralPubKey !== 'string'
    || value.desktopEphemeralPubKey.length < 1
    || value.desktopEphemeralPubKey.length > 256
    || typeof value.desktopIdentityPubKey !== 'string'
    || value.desktopIdentityPubKey.length < 1
    || value.desktopIdentityPubKey.length > 256
    || typeof value.issuedAtMs !== 'number'
    || !Number.isInteger(value.issuedAtMs)
    || value.issuedAtMs < 0
    || typeof value.expiresInMs !== 'number'
    || !Number.isInteger(value.expiresInMs)
    || value.expiresInMs < 1
    || value.expiresInMs > 90000
    || (value.relay !== undefined && !validRelay(value.relay))
  ) {
    return { ok: false, errors: 'invalid MobilePairingQr' };
  }

  return { ok: true, value: value as unknown as MobilePairingQr };
}
