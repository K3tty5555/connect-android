import * as Crypto from 'expo-crypto';

/** Must stay byte-for-byte aligned with src/main/mobileBridgeRelay.ts. */
export async function relayTicketForDevice(deviceId: string, desktopIdentityPubKey: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${deviceId}:${desktopIdentityPubKey}`,
  );
  const bytes = hex.match(/.{2}/gu)?.slice(0, 24).map((pair) => Number.parseInt(pair, 16)) ?? [];
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    encoded += alphabet[(triple >>> 18) & 63];
    encoded += alphabet[(triple >>> 12) & 63];
    encoded += i + 1 < bytes.length ? alphabet[(triple >>> 6) & 63] : '=';
    encoded += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return `rt_${encoded.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`;
}
