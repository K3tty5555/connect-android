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
  if (typeof value.host === 'string' && !isMobileBridgeIpv4(value.host)) {
    throw new PairingError(
      'invalid_qr',
      '这不是 Connect 支持的私网配对地址。',
    );
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 8
    || !keys.every((key) => [
      'v', 'host', 'port', 'pairingCode', 'desktopEphemeralPubKey', 'desktopIdentityPubKey',
      'issuedAtMs', 'expiresInMs',
    ].includes(key))
    || value.v !== MOBILE_PROTOCOL_VERSION
    || typeof value.host !== 'string'
    || !isMobileBridgeIpv4(value.host)
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
  ) {
    throw new PairingError('invalid_qr', '这不是 Connect 配对二维码。');
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

  async start(rawQr: string, deviceName: string): Promise<string> {
    this.cancel();
    const generation = this.generation.capture();
    const qr = parsePairingQr(rawQr, this.now());
    if (deviceName.length < 1 || deviceName.length > 128) {
      throw new PairingError('connection_failed', '设备名称无效。');
    }
    this.qr = qr;
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
      const socket = this.socketFactory(`ws://${qr.host}:${qr.port}`);
      this.socket = socket;
      socket.onopen = () => {
        if (socket === this.socket) socket.send(JSON.stringify(request));
      };
      socket.onmessage = (event) => this.handleMessage(socket, event.data);
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
          '连接电脑超时，请确认 iPhone 和 Mac 已连接 Tailscale 或同一局域网。',
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
      if (!isObject(value) || Object.keys(value).length !== 4 || value.v !== MOBILE_PROTOCOL_VERSION) throw new Error();
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
    const profile = this.desktopResult;
    if (!this.mobileConfirmed || !profile || !this.resultResolve) return;
    try {
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
