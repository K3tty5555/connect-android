import * as Crypto from 'expo-crypto';
import { GenerationGuard } from '../domain/boundedReconciler';
import { PairedDesktopStore, isMobileBridgeIpv4, validatePairedDesktopProfile } from '../net/pairedDesktop';
import {
  computePairingConfirmation,
  computeSas,
  derivePairingKey,
  ed25519PublicKeyFromSpki,
  generateX25519KeyPair,
  x25519PublicKeyFromSpki,
  x25519PublicKeyToSpki,
} from '../net/protocolCrypto';
import { relayTicketForDevice } from '../net/relayTransport';
import { socketDataToText } from '../net/bytes';
import { isRelayOnlyPairingHost } from '../../../../src/shared/mobilePairingQrBoundary';
import {
  MOBILE_PROTOCOL_VERSION,
  type PairedDesktopProfile,
  type SocketLike,
} from '../net/bridgeClient';

const POLICY_CLOSE = 1008;
const CONNECTION_TIMEOUT_MS = 15_000;

export interface PairingQrPayload {
  v: 2;
  host: string;
  port: number;
  pairingCode: string;
  desktopEphemeralPubKey: string;
  desktopIdentityPubKey: string;
  issuedAtMs: number;
  expiresInMs: number;
  relay?: { url: string; ticket: string };
}

export interface PairingRelayConfig {
  url: string;
  apiKey: string;
  fallbacks?: Array<{ url: string; apiKey: string }>;
}

export interface PairingIdentity {
  ensureIdentity(): Promise<{ publicKey: string }>;
}

export type PairingState = 'idle' | 'connecting' | 'sas' | 'waiting_desktop' | 'paired' | 'rejected';

export class PairingError extends Error {
  constructor(
    readonly code: 'invalid_qr' | 'version_mismatch' | 'expired' | 'rejected' | 'connection_failed',
    message: string,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePairingQr(raw: string, nowMs = Date.now()): PairingQrPayload {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new PairingError('invalid_qr', '这不是 Connect 配对二维码。');
  }
  if (!isObject(value)) throw new PairingError('invalid_qr', '这不是 Connect 配对二维码。');
  // 确是 Connect 的配对码、只是协议版本不同：说清该更新哪一端，而不是笼统地「不是配对二维码」。
  if (
    typeof value.v === 'number'
    && value.v !== MOBILE_PROTOCOL_VERSION
    && typeof value.pairingCode === 'string'
    && typeof value.desktopIdentityPubKey === 'string'
  ) {
    throw new PairingError(
      'version_mismatch',
      value.v > MOBILE_PROTOCOL_VERSION
        ? '电脑上的 Connect 较新，请先更新手机上的 Connect。'
        : '电脑上的 Connect 较旧，请先在电脑上更新 Connect。',
    );
  }
  const keys = Object.keys(value);
  const relay = value.relay;
  const relayValid = relay === undefined || (
    isObject(relay)
    && Object.keys(relay).length === 2
    && typeof relay.url === 'string'
    && /^wss:\/\//u.test(relay.url)
    && relay.url.length <= 512
    && typeof relay.ticket === 'string'
    && /^rt_[A-Za-z0-9_-]{24,96}$/u.test(relay.ticket)
  );
  if (
    (keys.length !== 8 && keys.length !== 9)
    || !keys.every((key) => [
      'v', 'host', 'port', 'pairingCode', 'desktopEphemeralPubKey', 'desktopIdentityPubKey',
      'issuedAtMs', 'expiresInMs', 'relay',
    ].includes(key))
    || value.v !== MOBILE_PROTOCOL_VERSION
    || typeof value.host !== 'string'
    || !Number.isInteger(value.port)
    || (value.port as number) < 1
    || (value.port as number) > 65_535
    || typeof value.pairingCode !== 'string'
    || !/^\d{6}$/u.test(value.pairingCode)
    || typeof value.desktopEphemeralPubKey !== 'string'
    || typeof value.desktopIdentityPubKey !== 'string'
    || !Number.isSafeInteger(value.issuedAtMs)
    || !Number.isInteger(value.expiresInMs)
    || (value.expiresInMs as number) <= 0
    || (value.expiresInMs as number) > 90_000
    || !relayValid
  ) {
    throw new PairingError('invalid_qr', '这不是 Connect 配对二维码。');
  }
  if (
    !isMobileBridgeIpv4(value.host)
    && !(relay !== undefined && isRelayOnlyPairingHost(value.host))
  ) {
    throw new PairingError(
      'invalid_qr',
      '这不是 Connect 支持的配对地址。',
    );
  }
  try {
    x25519PublicKeyFromSpki(value.desktopEphemeralPubKey);
    ed25519PublicKeyFromSpki(value.desktopIdentityPubKey);
  } catch {
    throw new PairingError('invalid_qr', '这不是 Connect 配对二维码。');
  }
  if (
    nowMs < (value.issuedAtMs as number)
    || nowMs >= (value.issuedAtMs as number) + (value.expiresInMs as number)
  ) {
    throw new PairingError('expired', '配对二维码已过期，请在电脑上重新生成。');
  }
  return value as unknown as PairingQrPayload;
}

interface PairingClientOptions {
  identity: PairingIdentity;
  profileStore?: PairedDesktopStore;
  socketFactory?: (url: string) => SocketLike;
  randomBytes?: (length: number) => Uint8Array;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  onState?: (state: PairingState) => void;
}

export class PairingClient {
  private readonly identity: PairingIdentity;
  private readonly profileStore: PairedDesktopStore;
  private readonly socketFactory: (url: string) => SocketLike;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly now: () => number;
  private readonly schedule: NonNullable<PairingClientOptions['schedule']>;
  private readonly cancelSchedule: NonNullable<PairingClientOptions['cancelSchedule']>;
  private readonly onState?: (state: PairingState) => void;
  private socket: SocketLike | null = null;
  private qr: PairingQrPayload | null = null;
  private sas: string | null = null;
  private desktopResult: PairedDesktopProfile | null = null;
  private sasResolve: ((sas: string) => void) | null = null;
  private sasReject: ((error: Error) => void) | null = null;
  private resultResolve: ((profile: PairedDesktopProfile) => void) | null = null;
  private resultReject: ((error: Error) => void) | null = null;
  private mobileConfirmed = false;
  private readonly generation = new GenerationGuard();
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private relayConfig: PairingRelayConfig | null = null;
  private relayCredential: string | null = null;

  state: PairingState = 'idle';

  constructor(options: PairingClientOptions) {
    this.identity = options.identity;
    this.profileStore = options.profileStore ?? new PairedDesktopStore();
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.randomBytes = options.randomBytes ?? ((length) => Crypto.getRandomBytes(length));
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
    this.onState = options.onState;
  }

  async start(rawQr: string, deviceName: string, relayConfig?: PairingRelayConfig): Promise<string> {
    this.cancel();
    const generation = this.generation.capture();
    const qr = parsePairingQr(rawQr, this.now());
    if (deviceName.length < 1 || deviceName.length > 128) {
      throw new PairingError('connection_failed', '设备名称无效。');
    }
    this.qr = qr;
    this.relayConfig = relayConfig ?? null;
    this.relayCredential = null;
    if (qr.relay !== undefined && (
      this.relayConfig === null
      || this.relayConfig.url !== qr.relay.url
      || !/^ck_live_[A-Za-z0-9_-]{32,140}$/u.test(this.relayConfig.apiKey)
    )) {
      throw new PairingError('connection_failed', '请先在手机上保存这个 Relay 的地址和 API Key。');
    }
    this.setState('connecting');
    const identity = await this.identity.ensureIdentity();
    if (!this.generation.isCurrent(generation)) {
      throw new PairingError('rejected', '配对已取消。');
    }
    ed25519PublicKeyFromSpki(identity.publicKey);

    const ephemeral = generateX25519KeyPair(() => this.randomBytes(32));
    let pairingKey: Uint8Array | null = null;
    try {
      pairingKey = derivePairingKey(
        ephemeral.privateKey,
        qr.desktopEphemeralPubKey,
        qr.pairingCode,
      );
      this.sas = computeSas(pairingKey);
      const requestBase = {
        v: MOBILE_PROTOCOL_VERSION,
        deviceName,
        identityPubKey: identity.publicKey,
        ephemeralPubKey: x25519PublicKeyToSpki(ephemeral.publicKey),
      };
      const request = {
        ...requestBase,
        pairingConfirm: computePairingConfirmation(pairingKey, requestBase),
      };
      const socket = this.socketFactory(qr.relay?.url ?? `ws://${qr.host}:${qr.port}`);
      this.socket = socket;
      let relayReady = qr.relay === undefined;
      socket.onopen = () => {
        if (socket !== this.socket) return;
        if (qr.relay && this.relayConfig) {
          socket.send(JSON.stringify({
            v: 1,
            kind: 'join',
            role: 'mobile',
            ticket: qr.relay.ticket,
            apiKey: this.relayConfig.apiKey,
          }));
          return;
        }
        socket.send(JSON.stringify(request));
      };
      socket.onmessage = (event) => {
        // 中转可能把文本帧重发成二进制帧(RN 投递 ArrayBuffer),先还原成文本再走协议。
        const text = socketDataToText(event.data);
        if (text === null) {
          this.fail(socket);
          return;
        }
        if (!relayReady) {
          try {
            const message = JSON.parse(text) as Record<string, unknown>;
            if (message.v === 1 && message.kind === 'error' && typeof message.code === 'string') {
              this.failRelay(socket, message.code);
              return;
            }
            if (message.v !== 1 || message.kind !== 'peer') throw new Error('relay handshake rejected');
            relayReady = true;
            socket.send(JSON.stringify(request));
          } catch {
            this.fail(socket);
          }
          return;
        }
        this.handleMessage(socket, text);
      };
      socket.onerror = () => {};
      socket.onclose = (event) => this.handleClose(socket, event.code);
    } finally {
      ephemeral.privateKey.fill(0);
      pairingKey?.fill(0);
    }

    const sasPromise = new Promise<string>((resolve, reject) => {
      this.sasResolve = resolve;
      this.sasReject = reject;
    });
    const socket = this.socket;
    if (socket !== null) {
      this.connectionTimer = this.schedule(() => {
        if (socket !== this.socket || this.state !== 'connecting') return;
        this.connectionTimer = null;
        this.socket = null;
        this.setState('rejected');
        this.rejectPending(new PairingError(
          'connection_failed',
          this.qr?.relay
            ? '连接私人 Relay 超时，请检查 Relay 地址、API Key 和服务器状态。'
            : '连接电脑超时，请确认 iPhone 和 Mac 已连接 Tailscale 或同一局域网。',
        ));
        socket.close(1000, 'pairing connection timeout');
      }, CONNECTION_TIMEOUT_MS);
    }
    return sasPromise;
  }

  confirmSas(): Promise<PairedDesktopProfile> {
    if (this.state !== 'sas' || this.sas === null) {
      return Promise.reject(new PairingError('connection_failed', '配对核对尚未就绪。'));
    }
    this.mobileConfirmed = true;
    this.setState('waiting_desktop');
    return new Promise<PairedDesktopProfile>((resolve, reject) => {
      this.resultResolve = resolve;
      this.resultReject = reject;
      void this.finishIfReady();
    });
  }

  rejectSas(): void {
    this.setState('rejected');
    this.socket?.close(POLICY_CLOSE, 'sas mismatch');
    this.socket = null;
    this.rejectPending(new PairingError('rejected', '配对已取消。'));
  }

  cancel(): void {
    this.generation.invalidate();
    this.clearConnectionTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, 'pairing cancelled');
    this.qr = null;
    this.sas = null;
    this.desktopResult = null;
    this.relayConfig = null;
    this.relayCredential = null;
    this.mobileConfirmed = false;
    this.rejectPending(new PairingError('rejected', '配对已取消。'));
    this.setState('idle');
  }

  private setState(state: PairingState): void {
    if (this.state === state) return;
    this.state = state;
    this.onState?.(state);
  }

  private handleMessage(socket: SocketLike, data: unknown): void {
    if (socket !== this.socket || typeof data !== 'string') return;
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      this.fail(socket);
      return;
    }
    if (isObject(value) && value.v === MOBILE_PROTOCOL_VERSION && value.kind === 'serverHello') return;
    if (
      isObject(value)
      && Object.keys(value).length === 3
      && value.v === MOBILE_PROTOCOL_VERSION
      && value.kind === 'pairPending'
      && typeof value.pairingId === 'string'
      && value.pairingId.length >= 1
      && value.pairingId.length <= 128
    ) {
      if (this.sas === null) return this.fail(socket);
      this.clearConnectionTimer();
      this.setState('sas');
      this.sasResolve?.(this.sas);
      this.sasResolve = null;
      this.sasReject = null;
      return;
    }
    try {
      if (!isObject(value) || (Object.keys(value).length !== 4 && Object.keys(value).length !== 5) || value.v !== MOBILE_PROTOCOL_VERSION) throw new Error();
      const qr = this.qr;
      if (!qr) throw new Error();
      const profile: PairedDesktopProfile = {
        v: 1,
        host: qr.host,
        port: qr.port,
        deviceId: String(value.deviceId),
        desktopIdentityPubKey: String(value.desktopIdentityPubKey),
        scopes: value.scopes as ('read' | 'write')[],
      };
      const relayCredential = value.relayCredential;
      if (relayCredential !== undefined && (typeof relayCredential !== 'string' || !/^rc_[A-Za-z0-9_-]{32,160}$/u.test(relayCredential))) throw new Error();
      this.relayCredential = relayCredential ?? null;
      ed25519PublicKeyFromSpki(profile.desktopIdentityPubKey);
      if (
        profile.desktopIdentityPubKey !== qr.desktopIdentityPubKey
        || !DEVICE_ID(profile.deviceId)
        || profile.scopes.length !== 1
        || profile.scopes[0] !== 'read'
      ) {
        throw new Error();
      }
      this.desktopResult = validatePairedDesktopProfile(profile);
      void this.finishIfReady();
    } catch {
      this.fail(socket);
    }
  }

  private async finishIfReady(): Promise<void> {
    let profile = this.desktopResult;
    if (!this.mobileConfirmed || !profile || !this.resultResolve) return;
    try {
      if (this.qr?.relay && this.relayConfig) {
        profile = {
          ...profile,
          relay: {
            url: this.relayConfig.url,
            apiKey: this.relayConfig.apiKey,
            ticket: await relayTicketForDevice(profile.deviceId, profile.desktopIdentityPubKey),
            ...(this.relayCredential ? { credential: this.relayCredential } : {}),
            ...(this.relayConfig.fallbacks && this.relayConfig.fallbacks.length > 0 ? { fallbacks: this.relayConfig.fallbacks } : {}),
          },
        };
      }
      await this.profileStore.save(profile);
      this.setState('paired');
      this.resultResolve(profile);
      this.resultResolve = null;
      this.resultReject = null;
    } catch {
      const error = new PairingError('connection_failed', '无法保存配对结果。');
      this.resultReject?.(error);
      this.resultResolve = null;
      this.resultReject = null;
    }
  }

  private handleClose(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.clearConnectionTimer();
    this.socket = null;
    if (this.state === 'paired') return;
    if (this.desktopResult !== null) {
      if (this.mobileConfirmed) void this.finishIfReady();
      return;
    }
    const error = new PairingError(
      code === POLICY_CLOSE ? 'rejected' : 'connection_failed',
      code === POLICY_CLOSE ? '电脑拒绝了配对请求。' : '配对连接已断开。',
    );
    this.setState('rejected');
    this.rejectPending(error);
  }

  private fail(socket: SocketLike): void {
    this.clearConnectionTimer();
    const error = new PairingError('rejected', '电脑拒绝了配对请求。');
    this.setState('rejected');
    this.rejectPending(error);
    socket.close(POLICY_CLOSE, 'mobile_bridge_rejected');
  }

  private failRelay(socket: SocketLike, code: string): void {
    this.clearConnectionTimer();
    const message = code === 'unauthorized'
      ? 'Relay API Key 无效或已过期，请检查手机上的 Relay 设置。'
      : code === 'expired'
        ? 'Relay 配对二维码已过期，请在 Mac 上重新生成。'
        : code === 'rate_limited'
          ? 'Relay 当前连接数已满，请稍后重试。'
          : 'Relay 暂时拒绝了连接，请检查服务器状态。';
    const error = new PairingError('connection_failed', message);
    this.setState('rejected');
    this.rejectPending(error);
    socket.close(POLICY_CLOSE, 'relay_rejected');
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer === null) return;
    this.cancelSchedule(this.connectionTimer);
    this.connectionTimer = null;
  }

  private rejectPending(error: Error): void {
    this.sasReject?.(error);
    this.resultReject?.(error);
    this.sasResolve = null;
    this.sasReject = null;
    this.resultResolve = null;
    this.resultReject = null;
  }
}

function DEVICE_ID(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(value);
}
