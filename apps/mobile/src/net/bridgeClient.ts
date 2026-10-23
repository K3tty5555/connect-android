import * as Crypto from 'expo-crypto';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
} from 'expo-crypto';
import { base64ToBytes, bytesToBase64, bytesToText, socketDataToText, textToBytes } from './bytes';
import {
  DeviceIdentityStore,
  IdentityAccessError,
} from './deviceIdentity';
import { isAcceptableDesktopEndpoint, isMobileBridgeIpv4 } from './pairedDesktop';
import { isRelayOnlyPairingHost } from '../../../../src/shared/mobilePairingQrBoundary';
import {
  MobileConnectFailureError,
  classifyMobileConnectFailure,
} from './mobileConnectFailure';
import {
  MOBILE_SNAPSHOT_MAX_BYTES,
  MOBILE_SNAPSHOT_MAX_FRAGMENTS,
  TerminalSnapshotAssembler,
  type FragmentedPtyReplayEvent,
} from '../terminal/terminalSnapshotAssembler';
import {
  MOBILE_HISTORY_MAX_BYTES,
  MOBILE_HISTORY_MAX_FRAGMENTS,
  TerminalHistoryAssembler,
  type AssembledPtyHistory,
  type PtyHistoryEvent,
} from '../terminal/terminalHistoryAssembler';
import {
  buildTranscript,
  counterIv,
  deriveSessionKeys,
  ed25519PublicKeyFromSpki,
  generateX25519KeyPair,
  verifyEd25519,
  x25519PublicKeyToSpki,
} from './protocolCrypto';
import {
  MobilePerformanceTrace,
  type MobilePerformanceMark,
} from '../performance/mobilePerformanceTrace';
import {
  MobileConnectionRecoveryOwner,
  type MobileConnectionRecoveryReason,
} from '../domain/mobileConnectionRecoveryOwner';
import { MobileConnectionFlapGuard } from './mobileConnectionFlapGuard';
import type {
  MobilePanelState,
  MobileServerCapability,
  TerminalGridFrame,
  TerminalGridRow,
  TerminalGridStyle,
  TerminalTransportRenderer,
} from '../../../../src/shared/types';
import type {
  TerminalKeyModifiers,
  TerminalKeyName,
  TerminalMouseAction,
  TerminalMouseButton,
} from '../../../../src/shared/terminalInput';
import {
  MOBILE_CAPABILITY_PROBE_REQUEST_ID,
  MOBILE_CAPABILITY_PROBE_V2_REQUEST_ID,
} from '../../../../src/shared/types';
import type {
  MobileFileContentKind,
  MobileFileEntry,
  MobileFileMutation,
  MobileFileMutationOp,
} from '../../../../src/shared/types';
import {
  isMobileWorkspaceEntryName,
  isMobileWorkspaceSubPath,
  MOBILE_FILE_CHUNK_BYTES,
  MOBILE_FILE_MAX_CHUNKS,
  MOBILE_FILE_MEDIA_MAX_BYTES,
  MOBILE_FILE_TEXT_MAX_BYTES,
} from '../../../../src/shared/mobileFileBoundary';

const MAX_COUNTER = Number.MAX_SAFE_INTEGER;
const POLICY_CLOSE = 1008;
const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const PANEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,255}$/u;
const WORKSPACE_CAPABILITY_RE = /^wcap_[A-Za-z0-9_-]{24,64}$/u;
const ROOM_CAPABILITY_RE = /^rcap_[A-Za-z0-9_-]{24,64}$/u;
const ROOM_IMAGE_CAPABILITY_RE = /^icap_[A-Za-z0-9_-]{24,64}$/u;
const TERMINAL_IMAGE_CAPABILITY_RE = /^ticap_[A-Za-z0-9_-]{24,64}$/u;
const REQUEST_ID_RE = /^req_[A-Za-z0-9_-]{8,64}$/u;
const NOTIFICATION_ID_RE = /^ncap_[A-Za-z0-9_-]{24,64}$/u;
const FILE_CAPABILITY_RE = /^fcap_[A-Za-z0-9_-]{24,64}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MIME_RE = /^[a-z]+\/[a-z0-9.+-]+$/u;
/** 未来桌面可能声明新能力：未知串只忽略，不得像 1.0.0 那样整份丢弃工作区列表。 */
const CAPABILITY_TOKEN_RE = /^[a-z0-9-]{1,40}$/u;
const KNOWN_SERVER_CAPABILITIES: readonly MobileServerCapability[] = [
  'terminal-grid-v1', 'workspace-files-v1', 'workspace-office-preview-v1', 'panel-states-v1',
  'endpoint-sync-v1',
];
/** ADR-003 §17：两次采纳桌面新地址的最小间隔（桌面换址要连续两次 10 秒检查确认，合法变化不会更密）。 */
const ENDPOINT_UPDATE_MIN_INTERVAL_MS = 5_000;
const PANEL_STATUSES: readonly MobilePanelState['status'][] = ['needs_input', 'error', 'unread', 'running', 'idle'];
const FILE_CONTENT_KINDS: readonly MobileFileContentKind[] = [
  'text', 'image', 'pdf', 'audio', 'video', 'office', 'unsupported', 'too_large', 'binary',
];
const FILE_MUTATION_OPS: readonly MobileFileMutationOp[] = ['createFile', 'createDir', 'rename', 'delete', 'paste'];
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_ENCRYPTED_PAYLOAD_BASE64_LENGTH = 2_666_668;
const COLLABORATION_AVATAR_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/u;
/**
 * The desktop pushes a heartbeat every 30 s, so silence past two of them means
 * the link is gone even though iOS may never deliver a close event.
 */
const INBOUND_SILENCE_PROBE_MS = 75_000;
const CAPABILITY_PROBE_MIN_TIMEOUT_MS = 5_000;
const CAPABILITY_PROBE_MAX_TIMEOUT_MS = 10_000;
export const MOBILE_PROTOCOL_VERSION = 2 as const;

export function createMobileRequestId(
  bytes: Uint8Array = Crypto.getRandomBytes(12),
): string {
  return `req_${bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`;
}

/**
 * How long a liveness probe waits before the socket is assumed dead.
 *
 * This used to be a flat 5s with no retry, which is the most expensive possible
 * reaction to one lost heartbeat: the deadline expires, `close(1012)` tears the
 * channel down, and the redial costs another four round trips. On the relay the
 * phone actually runs on — RTT p50 1.0-1.6s with measured packet loss, see
 * `dev-log/337` — a single dropped datagram cost roughly ten seconds.
 *
 * So scale it with the round trip this client already measures, the same way
 * `terminalCapabilityProbeTimeoutMs` and `ownershipReconcileDelayMs` do. Two
 * deadlines at the ceiling still resolve inside the 75s inbound-silence
 * watchdog that schedules probes, and far inside the desktop's 200s heartbeat
 * timeout, so a slow link can never be mistaken for a dead one.
 */
/**
 * 连上 Relay、发出 join 之后等桌面到来的上限。新 Relay 让手机先到先等（Mac 唤醒、Connect 重启
 * 的那几秒），8 秒拨号上限只管到 join 为止；等满仍没对端就重拨一次，Relay 侧有心跳清理死连接。
 */
export const RELAY_PEER_WAIT_MS = 45_000;

/**
 * 在后台待过这么久再回来，iOS 多半已静默掐断 socket：只发一次短探活（不重试），没回音就重拨；
 * 常规探活要 2×(5–15)s 才判死（2026-10-20）。socket 还活着时探活成功、连接不动，接管随之保留；
 * 已经断开的连接无论以哪种关闭码结束，桌面都会收回接管（mobileBridgeServer close → releasePty）。
 */
export const LONG_BACKGROUND_MS = 20_000;
export const QUICK_LIVENESS_PROBE_TIMEOUT_MS = 1_500;

export const LIVENESS_PROBE_MIN_TIMEOUT_MS = 5_000;
export const LIVENESS_PROBE_MAX_TIMEOUT_MS = 15_000;

export function livenessProbeTimeoutMs(roundTripMs: number | null): number {
  if (roundTripMs === null || !Number.isFinite(roundTripMs) || roundTripMs <= 0) {
    return LIVENESS_PROBE_MIN_TIMEOUT_MS;
  }
  return Math.min(
    LIVENESS_PROBE_MAX_TIMEOUT_MS,
    Math.max(LIVENESS_PROBE_MIN_TIMEOUT_MS, Math.ceil(roundTripMs * 3)),
  );
}

export function terminalCapabilityProbeTimeoutMs(roundTripMs: number | null): number {
  if (roundTripMs === null || !Number.isFinite(roundTripMs) || roundTripMs <= 0) {
    return CAPABILITY_PROBE_MIN_TIMEOUT_MS;
  }
  return Math.min(
    CAPABILITY_PROBE_MAX_TIMEOUT_MS,
    Math.max(CAPABILITY_PROBE_MIN_TIMEOUT_MS, Math.ceil(roundTripMs * 3)),
  );
}

export type MobileErrorCategory = 'retryable' | 'action_required' | 'permanent' | 'ambiguous';

/**
 * Raised once the phone gives up on dialling a desktop it cannot stay joined to.
 * Repeated drops say nothing about *why*, so this states only what happened;
 * the dial-failure diagnosis is what names a cause.
 */
export class MobileConnectionUnstableError extends Error {
  readonly category = 'action_required' as const;

  constructor() {
    super('与电脑的连接反复中断，已停止自动重连。');
    this.name = 'MobileConnectionUnstableError';
  }
}

export type MobileCommand =
  | { kind: 'listWorkspaces'; requestId?: string }
  | { kind: 'listPanels'; requestId?: string }
  | { kind: 'listRooms'; requestId?: string }
  | { kind: 'listNotifications'; requestId: string }
  | { kind: 'markNotificationsRead'; requestId: string; cursor: number }
  | { kind: 'watchPanelStates'; requestId: string }
  | { kind: 'markPanelRead'; requestId: string; panelId: string }
  | { kind: 'endpointSync'; requestId: string }
  | { kind: 'getCollaborationProfile'; requestId: string; workspaceCapability: string }
  | {
      kind: 'setCollaborationAvatar';
      requestId: string;
      workspaceCapability: string;
      avatar: string;
    }
  | { kind: 'attachRoom'; roomCapability: string }
  | { kind: 'sendRoom'; requestId: string; roomCapability: string; text: string }
  | {
      kind: 'beginRoomImageUpload';
      requestId: string;
      roomCapability: string;
      mime: MobileRoomImageMime;
      byteLength: number;
      sha256: string;
      chunkCount: number;
    }
  | {
      kind: 'roomImageChunk';
      requestId: string;
      uploadCapability: string;
      index: number;
      data: string;
    }
  | {
      kind: 'commitRoomMessage';
      requestId: string;
      roomCapability: string;
      text: string;
      uploadCapabilities: string[];
    }
  | {
      kind: 'beginRoomImageDownload';
      requestId: string;
      roomCapability: string;
      messageId: string;
      imageIndex: number;
    }
  | {
      kind: 'readRoomImageChunk';
      requestId: string;
      imageCapability: string;
      index: number;
    }
  | {
      kind: 'beginTerminalImageUpload';
      requestId: string;
      panelId: string;
      epoch: number;
      mime: MobileRoomImageMime;
      byteLength: number;
      sha256: string;
      chunkCount: number;
    }
  | {
      kind: 'terminalImageChunk';
      requestId: string;
      uploadCapability: string;
      index: number;
      data: string;
    }
  | {
      kind: 'commitTerminalImageMessage';
      requestId: string;
      panelId: string;
      epoch: number;
      uploadCapability: string;
      text: string;
    }
  | {
      kind: 'createSurface';
      requestId: string;
      workspaceCapability: string;
      surfaceKind: MobileSurfaceKind;
    }
  | { kind: 'closeSurface'; requestId: string; panelId: string; epoch: number }
  | {
      kind: 'attach';
      requestId?: string;
      panelId: string;
      afterSeq?: number;
      viewportFirst?: true;
      terminalRenderer?: TerminalTransportRenderer;
      cols?: number;
      rows?: number;
    }
  | { kind: 'queryOwnership'; requestId: string; panelId: string }
  | { kind: 'write'; requestId?: string; panelId: string; data: string; epoch: number; paste?: boolean }
  | { kind: 'writeBytes'; requestId?: string; panelId: string; data: string; epoch: number }
  | { kind: 'sendKey'; requestId?: string; panelId: string; key: TerminalKeyName; modifiers?: TerminalKeyModifiers; epoch: number }
  | { kind: 'mouse'; requestId?: string; panelId: string; action: TerminalMouseAction; button?: TerminalMouseButton; column: number; row: number; modifiers?: TerminalKeyModifiers; epoch: number }
  | { kind: 'copy'; requestId: string; panelId: string; mode: 'screen' | 'scrollback' }
  | { kind: 'resize'; panelId: string; cols: number; rows: number }
  | { kind: 'takeover'; requestId: string; panelId: string }
  | { kind: 'returnToDesktop'; requestId: string; panelId: string; epoch: number }
  | { kind: 'listFiles'; requestId: string; workspaceCapability: string; subPath: string }
  | {
      kind: 'openFile';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      /** 只在桌面声明 workspace-office-preview-v1 后才带：旧桌面按 additionalProperties 拒收未知字段。 */
      acceptContentKinds?: ['office'];
    }
  | { kind: 'readFileChunk'; requestId: string; fileCapability: string; index: number }
  | ({ kind: 'mutateFile'; requestId: string; workspaceCapability: string } & MobileFileMutation)
  | {
      kind: 'saveFile';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      expectedRevision: string;
      content: string;
    }
  | { kind: 'heartbeat'; requestId?: string };

export const INITIAL_MOBILE_CATALOG_COMMAND_KINDS = [] as const satisfies ReadonlyArray<MobileCommand['kind']>;

export type MobileEvent =
  | {
      kind: 'workspaceList';
      requestId?: string;
      capabilities?: MobileServerCapability[];
      workspaces: MobileWorkspaceSummary[];
    }
  | { kind: 'panelList'; requestId?: string; panels: MobilePanelSummary[] }
  | { kind: 'panelStates'; requestId?: string; panels: MobilePanelState[] }
  | { kind: 'endpointInfo'; requestId?: string; endpoint: { host: string; port: number } | null }
  | { kind: 'roomList'; requestId?: string; rooms: MobileRoomSummary[] }
  | {
      kind: 'notificationList';
      requestId: string;
      readCursor: number;
      latestCursor: number;
      notifications: MobileNotificationSummary[];
    }
  | { kind: 'notificationsRead'; requestId: string; readCursor: number }
  | { kind: 'collaborationProfile'; requestId?: string; avatar: string | null }
  | {
      kind: 'roomHistory';
      roomCapability: string;
      messages: MobileRoomMessage[];
      omittedMessages: number;
    }
  | { kind: 'roomMessage'; roomCapability: string; message: MobileRoomMessage }
  | { kind: 'roomSendAccepted'; requestId: string; roomCapability: string }
  | { kind: 'terminalWriteAccepted'; requestId: string; panelId: string }
  | { kind: 'terminalCopyResult'; requestId: string; panelId: string; mode: 'screen' | 'scrollback'; text: string }
  | {
      kind: 'roomImageUploadReady';
      requestId: string;
      roomCapability: string;
      uploadCapability: string;
      expiresInMs: 120_000;
    }
  | {
      kind: 'roomImageChunkAccepted';
      requestId: string;
      uploadCapability: string;
      nextIndex: number;
    }
  | {
      kind: 'roomImageDownloadReady';
      requestId: string;
      roomCapability: string;
      messageId: string;
      imageIndex: number;
      imageCapability: string;
      mime: MobileRoomImageMime;
      byteLength: number;
      sha256: string;
      chunkCount: number;
      expiresInMs: 120_000;
    }
  | {
      kind: 'roomImageDownloadChunk';
      requestId: string;
      imageCapability: string;
      index: number;
      data: string;
      complete: boolean;
    }
  | {
      kind: 'terminalImageUploadReady';
      requestId: string;
      panelId: string;
      uploadCapability: string;
      expiresInMs: 120_000;
    }
  | {
      kind: 'terminalImageChunkAccepted';
      requestId: string;
      uploadCapability: string;
      nextIndex: number;
    }
  | { kind: 'terminalImageMessageAccepted'; requestId: string; panelId: string }
  | {
      kind: 'surfaceCreateAccepted';
      requestId: string;
      workspaceCapability: string;
      surfaceKind: MobileSurfaceKind;
    }
  | { kind: 'surfaceCloseAccepted'; requestId: string; panelId: string }
  | TerminalGridFrame
  | {
      kind: 'ptyReplay';
      panelId: string;
      oldestSeq: number;
      upperSeq: number;
      droppedLines: number;
      omittedLines?: number;
      snapshot?: string;
      snapshotSeq?: number;
      cols?: number;
      rows?: number;
    }
  | FragmentedPtyReplayEvent
  | { kind: 'ptyReplayAbort'; panelId: string }
  | PtyHistoryEvent
  | { kind: 'ptyHistoryAbort'; panelId: string }
  | { kind: 'attachReady'; requestId: string; panelId: string }
  | {
      kind: 'ptyData';
      id: string;
      seq: number;
      upperSeq?: number;
      data: string;
      cols?: number;
      rows?: number;
    }
  | { kind: 'ptyExit'; id: string; exitCode: number }
  | { kind: 'deviceAccess'; scopes: ('read' | 'write')[] }
  | {
      kind: 'ownership';
      requestId?: string;
      panelId: string;
      owner: 'desktop' | 'mobile';
      epoch: number;
      controlledByThisDevice?: boolean;
    }
  | {
      kind: 'error';
      code: string;
      category: MobileErrorCategory;
      requestId?: string;
      panelId?: string;
      message?: string;
    }
  | {
      kind: 'fileList';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      entries: MobileFileEntry[];
      truncated: boolean;
    }
  | {
      kind: 'fileOpened';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      contentKind: MobileFileContentKind;
      fileCapability?: string;
      mime?: string;
      byteLength: number;
      sha256?: string;
      chunkCount: number;
      expiresInMs?: 120000;
    }
  | {
      kind: 'fileChunk';
      requestId: string;
      fileCapability: string;
      index: number;
      data: string;
      complete: boolean;
    }
  | {
      kind: 'fileMutationAccepted';
      requestId: string;
      workspaceCapability: string;
      op: MobileFileMutationOp;
      name?: string;
    }
  | {
      kind: 'fileSaved';
      requestId: string;
      workspaceCapability: string;
      subPath: string;
      revision: string;
      byteLength: number;
    }
  | { kind: 'heartbeat'; requestId?: string };

export interface MobilePanelSummary {
  panelId: string;
  kind: 'claude' | 'codex' | 'shell';
  label: string;
  workspaceCapability: string;
  workspaceLabel: string;
}

export interface MobileRoomSummary {
  roomCapability: string;
  label: string;
  workspaceCapability: string;
  workspaceLabel: string;
}

export interface MobileRoomMessage {
  id: string;
  from: 'user' | 'claude' | 'codex' | 'system';
  text: string;
  ts: number;
  pending?: boolean;
  queued?: boolean;
  model?: string;
  imageCount?: number;
}

export type MobileRoomImageMime = 'image/png' | 'image/jpeg';

export type MobileSurfaceKind = 'claude' | 'codex' | 'shell' | 'collaboration';

export interface MobileWorkspaceSummary {
  workspaceCapability: string;
  label: string;
  activeSurfaceCount: number;
}

export interface MobileNotificationSummary {
  notificationId: string;
  cursor: number;
  kind: 'completed' | 'waiting' | 'failed';
  title: '任务已完成' | '等待你处理' | '任务失败';
  createdAt: string;
  workspaceCapability: string;
  workspaceLabel: string;
  read: boolean;
  target?:
    | { type: 'panel'; panelId: string }
    | { type: 'room'; roomCapability: string };
}

export interface MobileFrame {
  v: 2;
  deviceId: string;
  counter: number;
  ciphertext: string;
  tag: string;
}

export interface FrameCipher {
  seal(
    key: Uint8Array,
    counter: number,
    plaintext: string,
  ): Promise<{ ciphertext: string; tag: string }>;
  open(
    key: Uint8Array,
    counter: number,
    ciphertext: string,
    tag: string,
  ): Promise<string>;
}

export class ExpoFrameCipher implements FrameCipher {
  private readonly keys = new WeakMap<Uint8Array, Promise<AESEncryptionKey>>();

  private key(value: Uint8Array): Promise<AESEncryptionKey> {
    let imported = this.keys.get(value);
    if (!imported) {
      imported = AESEncryptionKey.import(value) as Promise<AESEncryptionKey>;
      this.keys.set(value, imported);
    }
    return imported;
  }

  async seal(
    keyBytes: Uint8Array,
    counter: number,
    plaintext: string,
  ): Promise<{ ciphertext: string; tag: string }> {
    const key = await this.key(keyBytes);
    const sealed = await aesEncryptAsync(textToBytes(plaintext), key, {
      nonce: { bytes: counterIv(counter) },
      tagLength: 16,
    });
    const ciphertext = await sealed.ciphertext();
    const tag = await sealed.tag();
    return {
      ciphertext: bytesToBase64(ciphertext),
      tag: bytesToBase64(tag),
    };
  }

  async open(
    keyBytes: Uint8Array,
    counter: number,
    ciphertext: string,
    tag: string,
  ): Promise<string> {
    const key = await this.key(keyBytes);
    const sealed = AESSealedData.fromParts(
      counterIv(counter),
      base64ToBytes(ciphertext),
      base64ToBytes(tag),
    );
    const plaintext = await aesDecryptAsync(sealed, key, { output: 'bytes' });
    return bytesToText(plaintext);
  }
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_RE.test(value);
}

function validWorkspaceCapability(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_CAPABILITY_RE.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validOptionalGeometry(value: Record<string, unknown>): boolean {
  if (value.cols === undefined && value.rows === undefined) return true;
  return Number.isInteger(value.cols)
    && (value.cols as number) >= 2
    && (value.cols as number) <= 500
    && Number.isInteger(value.rows)
    && (value.rows as number) >= 1
    && (value.rows as number) <= 200;
}

function validRequiredGeometry(value: Record<string, unknown>): boolean {
  return value.cols !== undefined && value.rows !== undefined && validOptionalGeometry(value);
}

function validGridColor(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind === 'palette') {
    return exactKeys(value, ['kind', 'index'])
      && Number.isInteger(value.index)
      && (value.index as number) >= 0
      && (value.index as number) <= 255;
  }
  return value.kind === 'rgb'
    && exactKeys(value, ['kind', 'value'])
    && Number.isInteger(value.value)
    && (value.value as number) >= 0
    && (value.value as number) <= 0xffffff;
}

function validGridStyle(value: unknown): value is TerminalGridStyle {
  if (!isObject(value) || !exactKeys(value, [
    'foreground', 'background', 'bold', 'dim', 'italic', 'underline',
    'inverse', 'invisible', 'strikethrough', 'overline',
  ])) return false;
  return (value.foreground === undefined || validGridColor(value.foreground))
    && (value.background === undefined || validGridColor(value.background))
    && ['bold', 'dim', 'italic', 'underline', 'inverse', 'invisible', 'strikethrough', 'overline']
      .every((key) => typeof value[key] === 'boolean');
}

function validGridRow(value: unknown, cols: number): value is TerminalGridRow {
  if (
    !isObject(value)
    || !exactKeys(value, ['wrapped', 'spans'])
    || typeof value.wrapped !== 'boolean'
    || !Array.isArray(value.spans)
    || value.spans.length > 500
  ) return false;
  let previousEnd = 0;
  for (const span of value.spans) {
    if (
      !isObject(span)
      || !exactKeys(span, ['column', 'width', 'text', 'style'])
      || !Number.isInteger(span.column)
      || !Number.isInteger(span.width)
      || (span.column as number) < previousEnd
      || (span.column as number) < 0
      || (span.width as number) < 1
      || (span.column as number) + (span.width as number) > cols
      || typeof span.text !== 'string'
      || span.text.length < 1
      || span.text.length > 1000
      || !validGridStyle(span.style)
    ) return false;
    previousEnd = (span.column as number) + (span.width as number);
  }
  return true;
}

function terminalGridFrameValidationIssue(value: Record<string, unknown>): string | null {
  if (
    !exactKeys(value, [
      'kind', 'panelId', 'revision', 'upperSeq', 'full', 'cols', 'rows', 'screen',
      'omittedLines', 'scrolledRows', 'historyRows', 'viewportRows', 'cursor',
    ])
    || typeof value.panelId !== 'string'
    || !PANEL_ID_RE.test(value.panelId)
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || !Number.isSafeInteger(value.upperSeq)
    || (value.upperSeq as number) < 0
    || typeof value.full !== 'boolean'
    || !validRequiredGeometry(value)
    || (value.screen !== 'normal' && value.screen !== 'alternate')
    || !Number.isSafeInteger(value.omittedLines)
    || (value.omittedLines as number) < 0
    || !Number.isInteger(value.scrolledRows)
    || (value.scrolledRows as number) < 0
    || (value.scrolledRows as number) > 10_000
    || !Array.isArray(value.historyRows)
    || value.historyRows.length > 2_000
    || !Array.isArray(value.viewportRows)
    || value.viewportRows.length !== value.rows
  ) return 'metadata';
  const cols = value.cols as number;
  if (!value.historyRows.every((row) => validGridRow(row, cols))) return 'history_row';
  if (!value.viewportRows.every((row) => validGridRow(row, cols))) return 'viewport_row';
  if (value.cursor !== undefined) {
    if (
      !isObject(value.cursor)
      || !exactKeys(value.cursor, ['row', 'column', 'visible'])
      || !Number.isInteger(value.cursor.row)
      || (value.cursor.row as number) < 0
      || (value.cursor.row as number) >= (value.rows as number)
      || !Number.isInteger(value.cursor.column)
      || (value.cursor.column as number) < 0
      || (value.cursor.column as number) >= cols
      || typeof value.cursor.visible !== 'boolean'
    ) return 'cursor';
  }
  return null;
}

function validTerminalGridFrame(value: Record<string, unknown>): boolean {
  return terminalGridFrameValidationIssue(value) === null;
}

function validRoomMessage(value: unknown): value is MobileRoomMessage {
  if (!isObject(value) || !exactKeys(value, [
    'id', 'from', 'text', 'ts', 'pending', 'queued', 'model', 'imageCount',
  ])) return false;
  return typeof value.id === 'string'
    && value.id.length >= 1
    && value.id.length <= 64
    && !value.id.includes('\0')
    && (value.from === 'user' || value.from === 'claude' || value.from === 'codex' || value.from === 'system')
    && typeof value.text === 'string'
    && value.text.length <= 200_000
    && Number.isSafeInteger(value.ts)
    && (value.ts as number) >= 0
    && (value.pending === undefined || typeof value.pending === 'boolean')
    && (value.queued === undefined || typeof value.queued === 'boolean')
    && (value.model === undefined || (
      typeof value.model === 'string' && value.model.length >= 1 && value.model.length <= 120
    ))
    && (value.imageCount === undefined || (
      Number.isInteger(value.imageCount)
      && (value.imageCount as number) >= 1
      && (value.imageCount as number) <= 4
    ));
}

function validNotification(value: unknown): value is MobileNotificationSummary {
  if (!isObject(value) || !exactKeys(value, [
    'notificationId', 'cursor', 'kind', 'title', 'createdAt',
    'workspaceCapability', 'workspaceLabel', 'read', 'target',
  ])) return false;
  const titleMatches = value.kind === 'completed'
    ? value.title === '任务已完成'
    : value.kind === 'waiting'
      ? value.title === '等待你处理'
      : value.kind === 'failed' && value.title === '任务失败';
  const targetValid = value.target === undefined || (
    isObject(value.target)
    && (
      (
        exactKeys(value.target, ['type', 'panelId'])
        && value.target.type === 'panel'
        && typeof value.target.panelId === 'string'
        && PANEL_ID_RE.test(value.target.panelId)
      )
      || (
        exactKeys(value.target, ['type', 'roomCapability'])
        && value.target.type === 'room'
        && typeof value.target.roomCapability === 'string'
        && ROOM_CAPABILITY_RE.test(value.target.roomCapability)
      )
    )
  );
  return typeof value.notificationId === 'string'
    && NOTIFICATION_ID_RE.test(value.notificationId)
    && Number.isSafeInteger(value.cursor)
    && (value.cursor as number) >= 1
    && titleMatches
    && typeof value.createdAt === 'string'
    && value.createdAt.length <= 64
    && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.workspaceCapability === 'string'
    && WORKSPACE_CAPABILITY_RE.test(value.workspaceCapability)
    && typeof value.workspaceLabel === 'string'
    && value.workspaceLabel.length >= 1
    && value.workspaceLabel.length <= 160
    && typeof value.read === 'boolean'
    && targetValid;
}

function validBase64(
  value: unknown,
  min = 1,
  max = MAX_ENCRYPTED_PAYLOAD_BASE64_LENGTH,
): value is string {
  return typeof value === 'string'
    && value.length >= min
    && value.length <= max
    && value.length % 4 === 0
    && BASE64_RE.test(value);
}

function parseFrame(raw: string): MobileFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('invalid mobile frame');
  }
  if (
    !isObject(value)
    || !exactKeys(value, ['v', 'deviceId', 'counter', 'ciphertext', 'tag'])
    || value.v !== MOBILE_PROTOCOL_VERSION
    || typeof value.deviceId !== 'string'
    || !DEVICE_ID_RE.test(value.deviceId)
    || !Number.isSafeInteger(value.counter)
    || (value.counter as number) < 1
    || !validBase64(value.ciphertext)
    || !validBase64(value.tag, 20, 28)
  ) {
    throw new Error('invalid mobile frame');
  }
  return value as unknown as MobileFrame;
}

export class EncryptedChannel {
  private outboundCounter = 0;
  private inboundCounter = 0;
  private outbound = Promise.resolve();

  constructor(
    private readonly deviceId: string,
    private readonly sendKey: Uint8Array,
    private readonly receiveKey: Uint8Array,
    private readonly cipher: FrameCipher,
  ) {
    if (!DEVICE_ID_RE.test(deviceId)) throw new Error('invalid device id');
  }

  seal(payload: unknown): Promise<MobileFrame> {
    const operation = this.outbound.then(async () => {
      if (this.outboundCounter >= MAX_COUNTER) throw new Error('frame counter exhausted');
      const counter = this.outboundCounter + 1;
      this.outboundCounter = counter;
      const sealed = await this.cipher.seal(this.sendKey, counter, JSON.stringify(payload));
      return { v: MOBILE_PROTOCOL_VERSION, deviceId: this.deviceId, counter, ...sealed };
    });
    this.outbound = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async open(raw: string): Promise<unknown> {
    const frame = parseFrame(raw);
    if (frame.deviceId !== this.deviceId) throw new Error('frame device mismatch');
    if (frame.counter <= this.inboundCounter) throw new Error('frame counter replay');
    const plaintext = await this.cipher.open(
      this.receiveKey,
      frame.counter,
      frame.ciphertext,
      frame.tag,
    );
    this.inboundCounter = frame.counter;
    try {
      return JSON.parse(plaintext) as unknown;
    } catch {
      throw new Error('invalid encrypted payload');
    }
  }
}

type PtyDataEvent = Extract<MobileEvent, { kind: 'ptyData' }>;
type PtyReplayEvent = Extract<MobileEvent, { kind: 'ptyReplay' }>;

export interface PtyIngressTiming {
  socketReceivedAtMs: number;
  decryptedAtMs: number;
  rnDispatchedAtMs: number;
}

const MAX_SEQUENCE_LINE_LEDGER = 4096;

function countNewlines(data: string): number {
  let lines = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (data.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

interface PendingPanelSequence {
  delivered: number;
  buffered: Map<number, PtyDataEvent>;
  recoveryRequested: boolean;
  replayDroppedLines: number;
  replayUpperSeq: number | null;
  replayBatch: PtyDataEvent[];
  deliveredLineCounts: Map<number, number>;
  compactedDeliveredLines: number;
}

export class PtyEventSequencer {
  private readonly panels = new Map<string, PendingPanelSequence>();

  constructor(
    private readonly deliver: (event: PtyDataEvent) => void,
    private readonly requestRecovery: (panelId: string, expected: number, received: number) => void,
    private readonly reportLoss: (panelId: string, lines: number) => void = () => {},
    private readonly reportTrimmed: (panelId: string, lines: number) => void = () => {},
  ) {}

  acceptReplay(event: PtyReplayEvent): void {
    if (event.oldestSeq > event.upperSeq + 1) throw new Error('invalid PTY replay bounds');
    if (event.snapshot !== undefined && event.snapshotSeq !== undefined) {
      if (event.snapshotSeq !== event.upperSeq) throw new Error('invalid PTY snapshot boundary');
      this.panels.set(event.panelId, {
        delivered: event.snapshotSeq,
        buffered: new Map<number, PtyDataEvent>(),
        recoveryRequested: false,
        replayDroppedLines: 0,
        replayUpperSeq: null,
        replayBatch: [],
        deliveredLineCounts: new Map<number, number>(),
        compactedDeliveredLines: 0,
      });
      return;
    }
    const panel = this.panels.get(event.panelId);
    if (!panel) {
      const omittedLines = event.omittedLines ?? 0;
      this.panels.set(event.panelId, {
        delivered: event.oldestSeq - 1,
        buffered: new Map<number, PtyDataEvent>(),
        recoveryRequested: false,
        replayDroppedLines: event.droppedLines,
        replayUpperSeq: event.upperSeq >= event.oldestSeq ? event.upperSeq : null,
        replayBatch: [],
        deliveredLineCounts: new Map<number, number>(),
        compactedDeliveredLines: 0,
      });
      if (event.droppedLines > 0) this.reportLoss(event.panelId, event.droppedLines);
      if (omittedLines > 0) this.reportTrimmed(event.panelId, omittedLines);
      return;
    }
    if (event.droppedLines < panel.replayDroppedLines) {
      throw new Error('PTY replay loss counter regressed');
    }

    let observedEvictedLines = panel.compactedDeliveredLines;
    panel.compactedDeliveredLines = 0;
    for (const [seq, lines] of panel.deliveredLineCounts) {
      if (seq >= event.oldestSeq) continue;
      observedEvictedLines += lines;
      panel.deliveredLineCounts.delete(seq);
    }
    const newlyDroppedLines = event.droppedLines - panel.replayDroppedLines;
    if (panel.delivered >= event.oldestSeq) {
      observedEvictedLines += Math.min(
        newlyDroppedLines,
        panel.deliveredLineCounts.get(event.oldestSeq) ?? 0,
      );
    }
    const unseenDroppedLines = Math.max(0, newlyDroppedLines - observedEvictedLines);

    const expected = panel.delivered + 1;
    if (event.oldestSeq > expected) {
      const omittedLines = event.omittedLines ?? 0;
      if (unseenDroppedLines > 0 || omittedLines === 0) {
        this.reportLoss(event.panelId, unseenDroppedLines);
      }
      if (omittedLines > 0) this.reportTrimmed(event.panelId, omittedLines);
      panel.delivered = event.oldestSeq - 1;
      for (const seq of panel.buffered.keys()) {
        if (seq < event.oldestSeq) panel.buffered.delete(seq);
      }
    } else if (unseenDroppedLines > 0) {
      this.reportLoss(event.panelId, unseenDroppedLines);
    }
    panel.replayDroppedLines = event.droppedLines;
    panel.replayUpperSeq = event.upperSeq > panel.delivered ? event.upperSeq : null;
    panel.replayBatch = [];
  }

  accept(event: PtyDataEvent): void {
    const upperSeq = event.upperSeq ?? event.seq;
    if (upperSeq < event.seq) throw new Error('invalid PTY data bounds');
    const panel = this.panels.get(event.id) ?? {
      delivered: event.seq - 1,
      buffered: new Map<number, PtyDataEvent>(),
      recoveryRequested: false,
      replayDroppedLines: 0,
      replayUpperSeq: null,
      replayBatch: [],
      deliveredLineCounts: new Map<number, number>(),
      compactedDeliveredLines: 0,
    };
    this.panels.set(event.id, panel);
    if (upperSeq <= panel.delivered || panel.buffered.has(event.seq)) return;
    if (event.seq <= panel.delivered) {
      if (!panel.recoveryRequested) {
        panel.recoveryRequested = true;
        this.requestRecovery(event.id, panel.delivered + 1, event.seq);
      }
      return;
    }

    const expected = panel.delivered + 1;
    if (event.seq > expected) {
      panel.buffered.set(event.seq, event);
      if (!panel.recoveryRequested) {
        panel.recoveryRequested = true;
        this.requestRecovery(event.id, expected, event.seq);
      }
      return;
    }

    this.deliverOne(panel, event);
    for (const [seq, buffered] of panel.buffered) {
      if ((buffered.upperSeq ?? seq) <= panel.delivered) panel.buffered.delete(seq);
    }
    while (panel.buffered.has(panel.delivered + 1)) {
      const next = panel.buffered.get(panel.delivered + 1)!;
      panel.buffered.delete(next.seq);
      this.deliverOne(panel, next);
    }
    if (panel.buffered.size === 0) panel.recoveryRequested = false;
  }

  reset(): void {
    this.panels.clear();
  }

  resetPanel(panelId: string): void {
    this.panels.delete(panelId);
  }

  deliveredSeq(panelId: string): number {
    return this.panels.get(panelId)?.delivered ?? 0;
  }

  private deliverOne(panel: PendingPanelSequence, event: PtyDataEvent): void {
    const upperSeq = event.upperSeq ?? event.seq;
    panel.delivered = upperSeq;
    panel.deliveredLineCounts.set(upperSeq, countNewlines(event.data));
    while (panel.deliveredLineCounts.size > MAX_SEQUENCE_LINE_LEDGER) {
      const oldest = panel.deliveredLineCounts.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      panel.compactedDeliveredLines += panel.deliveredLineCounts.get(oldest) ?? 0;
      panel.deliveredLineCounts.delete(oldest);
    }
    if (panel.replayUpperSeq !== null && upperSeq <= panel.replayUpperSeq) {
      panel.replayBatch.push(event);
      if (upperSeq === panel.replayUpperSeq) {
        let batch: PtyDataEvent | null = null;
        for (const chunk of panel.replayBatch) {
          const chunkUpper = chunk.upperSeq ?? chunk.seq;
          if (
            batch !== null
            && batch.cols === chunk.cols
            && batch.rows === chunk.rows
          ) {
            batch.seq = chunkUpper;
            batch.upperSeq = chunkUpper;
            batch.data += chunk.data;
          } else {
            if (batch !== null) this.deliver(batch);
            batch = {
              kind: 'ptyData',
              id: chunk.id,
              seq: chunkUpper,
              upperSeq: chunkUpper,
              data: chunk.data,
              ...(chunk.cols === undefined ? {} : { cols: chunk.cols, rows: chunk.rows }),
            };
          }
        }
        if (batch !== null) this.deliver(batch);
        panel.replayUpperSeq = null;
        panel.replayBatch = [];
      }
      return;
    }
    this.deliver(event);
  }
}

/** 参与直连竞速的 host：RFC1918 私网或 Tailscale 100.64/10。192.0.2.x（Relay-only 档案占位）不参与。 */
function isRaceableDirectHost(host: string): boolean {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/u.test(host);
}

export function reconnectDelayMs(attempt: number, baseMs = 500, maxMs = 5_000): number {
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error('invalid reconnect attempt');
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
}

export function shouldRetryClose(input: { code: number; manual: boolean }): boolean {
  return !input.manual && input.code !== POLICY_CLOSE && input.code !== 1000;
}

function parseServerHello(value: unknown): { v: 2; kind: 'serverHello'; ephemeralPubKey: string } {
  if (
    !isObject(value)
    || !exactKeys(value, ['v', 'kind', 'ephemeralPubKey'])
    || value.v !== MOBILE_PROTOCOL_VERSION
    || value.kind !== 'serverHello'
    || !validBase64(value.ephemeralPubKey, 32, 512)
  ) throw new Error('invalid server hello');
  return value as unknown as { v: 2; kind: 'serverHello'; ephemeralPubKey: string };
}

function parseServerAuth(value: unknown): { v: 2; kind: 'serverAuth'; signature: string } {
  if (
    !isObject(value)
    || !exactKeys(value, ['v', 'kind', 'signature'])
    || value.v !== MOBILE_PROTOCOL_VERSION
    || value.kind !== 'serverAuth'
    || !validBase64(value.signature, 32, 512)
  ) throw new Error('invalid server authentication');
  return value as unknown as { v: 2; kind: 'serverAuth'; signature: string };
}

export function parseMobileEvent(value: unknown): MobileEvent {
  if (!isObject(value) || typeof value.kind !== 'string') throw new Error('invalid mobile event');
  switch (value.kind) {
    case 'workspaceList':
      if (
        exactKeys(value, ['kind', 'requestId', 'capabilities', 'workspaces'])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && (value.capabilities === undefined || (
          Array.isArray(value.capabilities)
          && value.capabilities.length <= 8
          && new Set(value.capabilities).size === value.capabilities.length
          && value.capabilities.every((capability) => (
            typeof capability === 'string' && CAPABILITY_TOKEN_RE.test(capability)
          ))
        ))
        && Array.isArray(value.workspaces)
        && value.workspaces.length <= 32
        && value.workspaces.every((workspace) => (
          isObject(workspace)
          && exactKeys(workspace, ['workspaceCapability', 'label', 'activeSurfaceCount'])
          && typeof workspace.workspaceCapability === 'string'
          && WORKSPACE_CAPABILITY_RE.test(workspace.workspaceCapability)
          && typeof workspace.label === 'string'
          && workspace.label.length >= 1
          && workspace.label.length <= 160
          && Number.isInteger(workspace.activeSurfaceCount)
          && (workspace.activeSurfaceCount as number) >= 0
          && (workspace.activeSurfaceCount as number) <= 100
        ))
      ) return {
        ...value,
        ...(value.capabilities === undefined ? {} : {
          capabilities: (value.capabilities as string[]).filter((capability): capability is MobileServerCapability => (
            (KNOWN_SERVER_CAPABILITIES as readonly string[]).includes(capability)
          )),
        }),
      } as unknown as MobileEvent;
      break;
    case 'panelList':
      if (
        exactKeys(value, ['kind', 'requestId', 'panels'])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && Array.isArray(value.panels)
        && value.panels.length <= 100
        && value.panels.every((panel) => (
          isObject(panel)
          && exactKeys(panel, ['panelId', 'kind', 'label', 'workspaceCapability', 'workspaceLabel'])
          && typeof panel.panelId === 'string'
          && PANEL_ID_RE.test(panel.panelId)
          && (panel.kind === 'claude' || panel.kind === 'codex' || panel.kind === 'shell')
          && typeof panel.label === 'string'
          && panel.label.length >= 1
          && panel.label.length <= 160
          && typeof panel.workspaceCapability === 'string'
          && WORKSPACE_CAPABILITY_RE.test(panel.workspaceCapability)
          && typeof panel.workspaceLabel === 'string'
          && panel.workspaceLabel.length >= 1
          && panel.workspaceLabel.length <= 160
        ))
      ) return value as unknown as MobileEvent;
      break;
    case 'panelStates':
      if (
        exactKeys(value, ['kind', 'requestId', 'panels'])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && Array.isArray(value.panels)
        && value.panels.length <= 100
        && value.panels.every((panel) => (
          isObject(panel)
          && exactKeys(panel, ['panelId', 'status'])
          && typeof panel.panelId === 'string'
          && PANEL_ID_RE.test(panel.panelId)
          && (PANEL_STATUSES as readonly unknown[]).includes(panel.status)
        ))
      ) return value as unknown as MobileEvent;
      break;
    case 'endpointInfo':
      // 只校验形状；网段白名单在采纳前（observeEndpoint）再用配对同一条规则判。
      if (
        exactKeys(value, ['kind', 'requestId', 'endpoint'])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && (value.endpoint === null || (
          isObject(value.endpoint)
          && exactKeys(value.endpoint, ['host', 'port'])
          && typeof value.endpoint.host === 'string'
          && /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/u.test(value.endpoint.host)
          && Number.isInteger(value.endpoint.port)
          && (value.endpoint.port as number) >= 1
          && (value.endpoint.port as number) <= 65_535
        ))
      ) return value as unknown as MobileEvent;
      break;
    case 'roomList':
      if (
        exactKeys(value, ['kind', 'requestId', 'rooms'])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && Array.isArray(value.rooms)
        && value.rooms.length <= 100
        && value.rooms.every((room) => (
          isObject(room)
          && exactKeys(room, ['roomCapability', 'label', 'workspaceCapability', 'workspaceLabel'])
          && typeof room.roomCapability === 'string'
          && ROOM_CAPABILITY_RE.test(room.roomCapability)
          && typeof room.label === 'string'
          && room.label.length >= 1
          && room.label.length <= 160
          && typeof room.workspaceCapability === 'string'
          && WORKSPACE_CAPABILITY_RE.test(room.workspaceCapability)
          && typeof room.workspaceLabel === 'string'
          && room.workspaceLabel.length >= 1
          && room.workspaceLabel.length <= 160
        ))
      ) return value as unknown as MobileEvent;
      break;
    case 'notificationList':
      if (
        exactKeys(value, ['kind', 'requestId', 'readCursor', 'latestCursor', 'notifications'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && Number.isSafeInteger(value.readCursor)
        && (value.readCursor as number) >= 0
        && Number.isSafeInteger(value.latestCursor)
        && (value.latestCursor as number) >= (value.readCursor as number)
        && Array.isArray(value.notifications)
        && value.notifications.length <= 256
        && value.notifications.every(validNotification)
        && new Set(value.notifications.map((item) => (item as MobileNotificationSummary).notificationId)).size
          === value.notifications.length
        && new Set(value.notifications.map((item) => (item as MobileNotificationSummary).cursor)).size
          === value.notifications.length
        && value.notifications.every((item) => (
          (item as MobileNotificationSummary).cursor <= (value.latestCursor as number)
          && (item as MobileNotificationSummary).read
            === ((item as MobileNotificationSummary).cursor <= (value.readCursor as number))
        ))
      ) return value as unknown as MobileEvent;
      break;
    case 'notificationsRead':
      if (
        exactKeys(value, ['kind', 'requestId', 'readCursor'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && Number.isSafeInteger(value.readCursor)
        && (value.readCursor as number) >= 0
      ) return value as unknown as MobileEvent;
      break;
    case 'terminalCopyResult':
      if (
        exactKeys(value, ['kind', 'requestId', 'panelId', 'mode', 'text'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && (value.mode === 'screen' || value.mode === 'scrollback')
        && typeof value.text === 'string'
        && value.text.length <= 2_000_000
      ) return value as unknown as MobileEvent;
      break;
    case 'collaborationProfile':
      if (
        exactKeys(value, ['kind', 'requestId', 'avatar'])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && (value.avatar === null || (
          typeof value.avatar === 'string'
          && value.avatar.length >= 27
          && value.avatar.length <= 800_000
          && COLLABORATION_AVATAR_RE.test(value.avatar)
        ))
      ) return value as unknown as MobileEvent;
      break;
    case 'roomHistory':
      if (
        exactKeys(value, ['kind', 'roomCapability', 'messages', 'omittedMessages'])
        && typeof value.roomCapability === 'string'
        && ROOM_CAPABILITY_RE.test(value.roomCapability)
        && Array.isArray(value.messages)
        && value.messages.length <= 512
        && value.messages.every(validRoomMessage)
        && Number.isSafeInteger(value.omittedMessages)
        && (value.omittedMessages as number) >= 0
      ) return value as unknown as MobileEvent;
      break;
    case 'roomMessage':
      if (
        exactKeys(value, ['kind', 'roomCapability', 'message'])
        && typeof value.roomCapability === 'string'
        && ROOM_CAPABILITY_RE.test(value.roomCapability)
        && validRoomMessage(value.message)
      ) return value as unknown as MobileEvent;
      break;
    case 'roomSendAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'roomCapability'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.roomCapability === 'string'
        && ROOM_CAPABILITY_RE.test(value.roomCapability)
      ) return value as unknown as MobileEvent;
      break;
    case 'terminalWriteAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'panelId'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
      ) return value as unknown as MobileEvent;
      break;
    case 'roomImageUploadReady':
      if (
        exactKeys(value, [
          'kind', 'requestId', 'roomCapability', 'uploadCapability', 'expiresInMs',
        ])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.roomCapability === 'string'
        && ROOM_CAPABILITY_RE.test(value.roomCapability)
        && typeof value.uploadCapability === 'string'
        && ROOM_IMAGE_CAPABILITY_RE.test(value.uploadCapability)
        && value.expiresInMs === 120_000
      ) return value as unknown as MobileEvent;
      break;
    case 'roomImageChunkAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'uploadCapability', 'nextIndex'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.uploadCapability === 'string'
        && ROOM_IMAGE_CAPABILITY_RE.test(value.uploadCapability)
        && Number.isInteger(value.nextIndex)
        && (value.nextIndex as number) >= 1
        && (value.nextIndex as number) <= 77
      ) return value as unknown as MobileEvent;
      break;
    case 'roomImageDownloadReady':
      if (
        exactKeys(value, [
          'kind', 'requestId', 'roomCapability', 'messageId', 'imageIndex',
          'imageCapability', 'mime', 'byteLength', 'sha256', 'chunkCount', 'expiresInMs',
        ])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.roomCapability === 'string'
        && ROOM_CAPABILITY_RE.test(value.roomCapability)
        && typeof value.messageId === 'string'
        && value.messageId.length >= 1
        && value.messageId.length <= 64
        && !value.messageId.includes('\0')
        && Number.isInteger(value.imageIndex)
        && (value.imageIndex as number) >= 0
        && (value.imageIndex as number) <= 3
        && typeof value.imageCapability === 'string'
        && ROOM_IMAGE_CAPABILITY_RE.test(value.imageCapability)
        && (value.mime === 'image/png' || value.mime === 'image/jpeg')
        && Number.isInteger(value.byteLength)
        && (value.byteLength as number) >= 1
        && (value.byteLength as number) <= 5_000_000
        && typeof value.sha256 === 'string'
        && /^[0-9a-f]{64}$/u.test(value.sha256)
        && Number.isInteger(value.chunkCount)
        && value.chunkCount === Math.ceil((value.byteLength as number) / (64 * 1024))
        && value.expiresInMs === 120_000
      ) return value as unknown as MobileEvent;
      break;
    case 'roomImageDownloadChunk': {
      if (
        exactKeys(value, [
          'kind', 'requestId', 'imageCapability', 'index', 'data', 'complete',
        ])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.imageCapability === 'string'
        && ROOM_IMAGE_CAPABILITY_RE.test(value.imageCapability)
        && Number.isInteger(value.index)
        && (value.index as number) >= 0
        && (value.index as number) <= 76
        && validBase64(value.data, 4, 87_384)
        && typeof value.complete === 'boolean'
      ) return value as unknown as MobileEvent;
      break;
    }
    case 'terminalImageUploadReady':
      if (
        exactKeys(value, ['kind', 'requestId', 'panelId', 'uploadCapability', 'expiresInMs'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && typeof value.uploadCapability === 'string'
        && TERMINAL_IMAGE_CAPABILITY_RE.test(value.uploadCapability)
        && value.expiresInMs === 120_000
      ) return value as unknown as MobileEvent;
      break;
    case 'terminalImageChunkAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'uploadCapability', 'nextIndex'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.uploadCapability === 'string'
        && TERMINAL_IMAGE_CAPABILITY_RE.test(value.uploadCapability)
        && Number.isInteger(value.nextIndex)
        && (value.nextIndex as number) >= 1
        && (value.nextIndex as number) <= 77
      ) return value as unknown as MobileEvent;
      break;
    case 'terminalImageMessageAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'panelId'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
      ) return value as unknown as MobileEvent;
      break;
    case 'surfaceCreateAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'workspaceCapability', 'surfaceKind'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.workspaceCapability === 'string'
        && WORKSPACE_CAPABILITY_RE.test(value.workspaceCapability)
        && (
          value.surfaceKind === 'claude'
          || value.surfaceKind === 'codex'
          || value.surfaceKind === 'shell'
          || value.surfaceKind === 'collaboration'
        )
      ) return value as unknown as MobileEvent;
      break;
    case 'surfaceCloseAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'panelId'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
      ) return value as unknown as MobileEvent;
      break;
    case 'heartbeat':
      if (
        exactKeys(value, ['kind', 'requestId'])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyReplay':
      if (
        exactKeys(value, [
          'kind',
          'panelId',
          'oldestSeq',
          'upperSeq',
          'droppedLines',
          'omittedLines',
          'snapshot',
          'snapshotSeq',
          'cols',
          'rows',
        ])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && Number.isSafeInteger(value.oldestSeq)
        && (value.oldestSeq as number) >= 1
        && Number.isSafeInteger(value.upperSeq)
        && (value.upperSeq as number) >= 0
        && Number.isSafeInteger(value.droppedLines)
        && (value.droppedLines as number) >= 0
        && (
          value.omittedLines === undefined
          || (Number.isSafeInteger(value.omittedLines) && (value.omittedLines as number) >= 0)
        )
        && (
          value.snapshot === undefined
          || (typeof value.snapshot === 'string' && value.snapshot.length <= 1048576)
        )
        && (
          value.snapshotSeq === undefined
          || (Number.isSafeInteger(value.snapshotSeq) && (value.snapshotSeq as number) >= 0)
        )
        && ((value.snapshot === undefined) === (value.snapshotSeq === undefined))
        && (value.snapshotSeq === undefined || value.snapshotSeq === value.upperSeq)
        && validOptionalGeometry(value)
        && (value.oldestSeq as number) <= (value.upperSeq as number) + 1
      ) return value as unknown as MobileEvent;
      break;
    case 'terminalGridFrame':
      if (validTerminalGridFrame(value)) return value as unknown as MobileEvent;
      throw new Error(`invalid terminal grid frame:${terminalGridFrameValidationIssue(value) ?? 'unknown'}`);
    case 'ptyReplayStart':
      if (
        exactKeys(value, [
          'kind',
          'panelId',
          'oldestSeq',
          'upperSeq',
          'droppedLines',
          'omittedLines',
          'snapshotSeq',
          'cols',
          'rows',
          'snapshotBytes',
          'fragmentCount',
        ])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && Number.isSafeInteger(value.oldestSeq)
        && (value.oldestSeq as number) >= 1
        && Number.isSafeInteger(value.upperSeq)
        && (value.upperSeq as number) >= 0
        && (value.oldestSeq as number) <= (value.upperSeq as number) + 1
        && Number.isSafeInteger(value.droppedLines)
        && (value.droppedLines as number) >= 0
        && Number.isSafeInteger(value.omittedLines)
        && (value.omittedLines as number) >= 0
        && Number.isSafeInteger(value.snapshotSeq)
        && value.snapshotSeq === value.upperSeq
        && validRequiredGeometry(value)
        && Number.isSafeInteger(value.snapshotBytes)
        && (value.snapshotBytes as number) >= 1
        && (value.snapshotBytes as number) <= MOBILE_SNAPSHOT_MAX_BYTES
        && Number.isInteger(value.fragmentCount)
        && (value.fragmentCount as number) >= 1
        && (value.fragmentCount as number) <= MOBILE_SNAPSHOT_MAX_FRAGMENTS
        && value.fragmentCount === Math.ceil((value.snapshotBytes as number) / (256 * 1024))
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyReplayChunk':
      if (
        exactKeys(value, ['kind', 'panelId', 'snapshotSeq', 'fragmentIndex', 'data'])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && Number.isSafeInteger(value.snapshotSeq)
        && (value.snapshotSeq as number) >= 0
        && Number.isInteger(value.fragmentIndex)
        && (value.fragmentIndex as number) >= 0
        && (value.fragmentIndex as number) < MOBILE_SNAPSHOT_MAX_FRAGMENTS
        && validBase64(value.data, 4, 349528)
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyReplayCommit':
      if (
        exactKeys(value, [
          'kind', 'panelId', 'snapshotSeq', 'snapshotBytes', 'fragmentCount',
        ])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && Number.isSafeInteger(value.snapshotSeq)
        && (value.snapshotSeq as number) >= 0
        && Number.isSafeInteger(value.snapshotBytes)
        && (value.snapshotBytes as number) >= 1
        && (value.snapshotBytes as number) <= MOBILE_SNAPSHOT_MAX_BYTES
        && Number.isInteger(value.fragmentCount)
        && (value.fragmentCount as number) >= 1
        && (value.fragmentCount as number) <= MOBILE_SNAPSHOT_MAX_FRAGMENTS
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyReplayAbort':
      if (
        exactKeys(value, ['kind', 'panelId'])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyHistoryStart':
      if (
        exactKeys(value, [
          'kind', 'panelId', 'snapshotSeq', 'omittedLines', 'cols', 'rows',
          'snapshotBytes', 'fragmentCount',
        ])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && Number.isSafeInteger(value.snapshotSeq)
        && (value.snapshotSeq as number) >= 0
        && Number.isSafeInteger(value.omittedLines)
        && (value.omittedLines as number) >= 0
        && validRequiredGeometry(value)
        && Number.isSafeInteger(value.snapshotBytes)
        && (value.snapshotBytes as number) >= 1
        && (value.snapshotBytes as number) <= MOBILE_HISTORY_MAX_BYTES
        && Number.isInteger(value.fragmentCount)
        && (value.fragmentCount as number) >= 1
        && (value.fragmentCount as number) <= MOBILE_HISTORY_MAX_FRAGMENTS
        && value.fragmentCount === Math.ceil((value.snapshotBytes as number) / 1024)
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyHistoryChunk':
      if (
        exactKeys(value, ['kind', 'panelId', 'snapshotSeq', 'fragmentIndex', 'data'])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && Number.isSafeInteger(value.snapshotSeq)
        && (value.snapshotSeq as number) >= 0
        && Number.isInteger(value.fragmentIndex)
        && (value.fragmentIndex as number) >= 0
        && (value.fragmentIndex as number) < MOBILE_HISTORY_MAX_FRAGMENTS
        && validBase64(value.data, 4, 1368)
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyHistoryCommit':
      if (
        exactKeys(value, [
          'kind', 'panelId', 'snapshotSeq', 'snapshotBytes', 'fragmentCount',
        ])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && Number.isSafeInteger(value.snapshotSeq)
        && (value.snapshotSeq as number) >= 0
        && Number.isSafeInteger(value.snapshotBytes)
        && (value.snapshotBytes as number) >= 1
        && (value.snapshotBytes as number) <= MOBILE_HISTORY_MAX_BYTES
        && Number.isInteger(value.fragmentCount)
        && (value.fragmentCount as number) >= 1
        && (value.fragmentCount as number) <= MOBILE_HISTORY_MAX_FRAGMENTS
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyHistoryAbort':
      if (
        exactKeys(value, ['kind', 'panelId'])
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
      ) return value as unknown as MobileEvent;
      break;
    case 'attachReady':
      if (
        exactKeys(value, ['kind', 'requestId', 'panelId'])
        && typeof value.requestId === 'string'
        && REQUEST_ID_RE.test(value.requestId)
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyData':
      if (
        exactKeys(value, ['kind', 'id', 'seq', 'upperSeq', 'data', 'cols', 'rows'])
        && typeof value.id === 'string'
        && PANEL_ID_RE.test(value.id)
        && Number.isSafeInteger(value.seq)
        && (value.seq as number) >= 1
        && (
          value.upperSeq === undefined
          || (
            Number.isSafeInteger(value.upperSeq)
            && (value.upperSeq as number) >= (value.seq as number)
          )
        )
        && typeof value.data === 'string'
        && value.data.length <= 1_048_576
        && validOptionalGeometry(value)
      ) return value as unknown as MobileEvent;
      break;
    case 'ptyExit':
      if (
        exactKeys(value, ['kind', 'id', 'exitCode'])
        && typeof value.id === 'string'
        && PANEL_ID_RE.test(value.id)
        && Number.isInteger(value.exitCode)
        && (value.exitCode as number) >= -2_147_483_648
        && (value.exitCode as number) <= 2_147_483_647
      ) return value as unknown as MobileEvent;
      break;
    case 'deviceAccess':
      if (
        exactKeys(value, ['kind', 'scopes'])
        && Array.isArray(value.scopes)
        && value.scopes.length >= 1
        && value.scopes.length <= 2
        && value.scopes.includes('read')
        && value.scopes.every((scope) => scope === 'read' || scope === 'write')
        && new Set(value.scopes).size === value.scopes.length
      ) return value as unknown as MobileEvent;
      break;
    case 'ownership':
      if (
        exactKeys(value, [
          'kind', 'requestId', 'panelId', 'owner', 'epoch', 'controlledByThisDevice',
        ])
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && typeof value.panelId === 'string'
        && PANEL_ID_RE.test(value.panelId)
        && (value.owner === 'desktop' || value.owner === 'mobile')
        && Number.isSafeInteger(value.epoch)
        && (value.epoch as number) >= 1
        && (
          value.controlledByThisDevice === undefined
          || typeof value.controlledByThisDevice === 'boolean'
        )
      ) return value as unknown as MobileEvent;
      break;
    case 'fileList':
      if (
        exactKeys(value, ['kind', 'requestId', 'workspaceCapability', 'subPath', 'entries', 'truncated'])
        && validRequestId(value.requestId)
        && validWorkspaceCapability(value.workspaceCapability)
        && isMobileWorkspaceSubPath(value.subPath)
        && Array.isArray(value.entries)
        && value.entries.length <= 1000
        && value.entries.every((entry) => (
          isObject(entry)
          && exactKeys(entry, ['name', 'dir', 'hidden'])
          && isMobileWorkspaceEntryName(entry.name)
          && typeof entry.dir === 'boolean'
          && typeof entry.hidden === 'boolean'
        ))
        && typeof value.truncated === 'boolean'
      ) return value as unknown as MobileEvent;
      break;
    case 'fileOpened': {
      const hasContent = value.fileCapability !== undefined;
      if (
        exactKeys(value, [
          'kind', 'requestId', 'workspaceCapability', 'subPath', 'contentKind', 'fileCapability',
          'mime', 'byteLength', 'sha256', 'chunkCount', 'expiresInMs',
        ])
        && validRequestId(value.requestId)
        && validWorkspaceCapability(value.workspaceCapability)
        && typeof value.subPath === 'string'
        && value.subPath.length > 0
        && isMobileWorkspaceSubPath(value.subPath)
        && (FILE_CONTENT_KINDS as readonly unknown[]).includes(value.contentKind)
        && (value.mime === undefined || (typeof value.mime === 'string' && value.mime.length <= 64 && MIME_RE.test(value.mime)))
        && Number.isInteger(value.byteLength)
        && (value.byteLength as number) >= 0
        && (value.byteLength as number) <= MOBILE_FILE_MEDIA_MAX_BYTES
        && (value.sha256 === undefined || (typeof value.sha256 === 'string' && SHA256_RE.test(value.sha256)))
        && Number.isInteger(value.chunkCount)
        && (hasContent
          ? typeof value.fileCapability === 'string'
            && FILE_CAPABILITY_RE.test(value.fileCapability)
            && value.sha256 !== undefined
            && value.expiresInMs === 120_000
            && value.chunkCount === Math.ceil((value.byteLength as number) / MOBILE_FILE_CHUNK_BYTES)
            && (value.chunkCount as number) >= 1
            && (value.chunkCount as number) <= MOBILE_FILE_MAX_CHUNKS
            && (value.contentKind !== 'text' || (value.byteLength as number) <= MOBILE_FILE_TEXT_MAX_BYTES)
          : value.chunkCount === 0 && value.expiresInMs === undefined)
      ) return value as unknown as MobileEvent;
      break;
    }
    case 'fileChunk':
      if (
        exactKeys(value, ['kind', 'requestId', 'fileCapability', 'index', 'data', 'complete'])
        && validRequestId(value.requestId)
        && typeof value.fileCapability === 'string'
        && FILE_CAPABILITY_RE.test(value.fileCapability)
        && Number.isInteger(value.index)
        && (value.index as number) >= 0
        && (value.index as number) < MOBILE_FILE_MAX_CHUNKS
        && validBase64(value.data, 4, Math.ceil(MOBILE_FILE_CHUNK_BYTES / 3) * 4)
        && typeof value.complete === 'boolean'
      ) return value as unknown as MobileEvent;
      break;
    case 'fileMutationAccepted':
      if (
        exactKeys(value, ['kind', 'requestId', 'workspaceCapability', 'op', 'name'])
        && validRequestId(value.requestId)
        && validWorkspaceCapability(value.workspaceCapability)
        && (FILE_MUTATION_OPS as readonly unknown[]).includes(value.op)
        && (value.name === undefined || isMobileWorkspaceEntryName(value.name))
      ) return value as unknown as MobileEvent;
      break;
    case 'fileSaved':
      if (
        exactKeys(value, ['kind', 'requestId', 'workspaceCapability', 'subPath', 'revision', 'byteLength'])
        && validRequestId(value.requestId)
        && validWorkspaceCapability(value.workspaceCapability)
        && typeof value.subPath === 'string'
        && value.subPath.length > 0
        && isMobileWorkspaceSubPath(value.subPath)
        && typeof value.revision === 'string'
        && SHA256_RE.test(value.revision)
        && Number.isInteger(value.byteLength)
        && (value.byteLength as number) >= 0
        && (value.byteLength as number) <= MOBILE_FILE_TEXT_MAX_BYTES
      ) return value as unknown as MobileEvent;
      break;
    case 'error': {
      const allowed = ['retryable', 'action_required', 'permanent', 'ambiguous'];
      if (
        exactKeys(value, ['kind', 'code', 'category', 'requestId', 'panelId', 'message'])
        && typeof value.code === 'string'
        && value.code.length >= 1
        && value.code.length <= 64
        && typeof value.category === 'string'
        && allowed.includes(value.category)
        && (value.requestId === undefined
          || (typeof value.requestId === 'string' && REQUEST_ID_RE.test(value.requestId)))
        && (value.panelId === undefined
          || (typeof value.panelId === 'string' && PANEL_ID_RE.test(value.panelId)))
        && (value.message === undefined || (typeof value.message === 'string' && value.message.length <= 512))
      ) return value as unknown as MobileEvent;
      break;
    }
  }
  throw new Error('invalid mobile event');
}

export interface PairedDesktopProfile {
  v: 1;
  host: string;
  port: number;
  deviceId: string;
  desktopIdentityPubKey: string;
  scopes: readonly ('read' | 'write')[];
  /** Optional user-owned Relay transport. Presence makes Tailscale unnecessary. */
  relay?: {
    url: string;
    ticket: string;
    apiKey: string;
    credential?: string;
    fallbacks?: Array<{ url: string; apiKey: string }>;
  };
}

function samePairedDesktop(
  current: PairedDesktopProfile | null,
  next: PairedDesktopProfile,
): boolean {
  return current !== null
    && current.deviceId === next.deviceId
    && current.desktopIdentityPubKey === next.desktopIdentityPubKey;
}

export type BridgeConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'authenticating'
  | 'confirming'
  | 'connected'
  | 'reconnecting'
  | 'rejected';

export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  /**
   * React Native hands the platform's failure description here. It is the only
   * thing that tells an unreachable network from a refused port — close code is
   * 1006 for both — so it is read, never logged or sent anywhere.
   */
  onerror: ((event?: { message?: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface BridgeClientCallbacks {
  onState?(state: BridgeConnectionState): void;
  onCatalogReady?(): void;
  onAuthorizationRejected?(): void;
  /**
   * An authentic frame this build could not render. Structured labels only, so
   * it is safe to log; the panel it names needs re-synchronising.
   */
  onPayloadRejected?(report: {
    kind: string;
    panelId: string | null;
    reason: string;
  }): void;
  onEvent?(event: MobileEvent): void;
  onPtyData?(event: PtyDataEvent, timing: PtyIngressTiming): void;
  onPtyHistory?(history: AssembledPtyHistory): void;
  onGap?(panelId: string, expected: number, received: number): void;
  onOutputLoss?(panelId: string, lines: number): void;
  onOutputTrimmed?(panelId: string, lines: number): void;
  /** 桌面能力协商完成（探针 v2，旧桌面回落 v1）。文件 UI 只在 workspaceFiles 为 true 时出现。 */
  /** answered=true 表示桌面确实回答了探针（而非超时）：此时缺能力意味着电脑上的 Connect 需要更新。 */
  onServerCapabilities?(capabilities: { terminalGrid: boolean; workspaceFiles: boolean; answered: boolean }): void;
  /** ADR-003 §17：桌面告知新地址，手机采纳后回调 App 以持久化。 */
  onEndpointChanged?(binding: { deviceId: string; desktopIdentityPubKey: string }, endpoint: { host: string; port: number }): void;
  /** ADR-003 §17：新地址经 L3 认证成功一次，App 可丢弃持久化的回退候选。 */
  onFallbackCleared?(): void;
  onTerminalRendererResolved?(resolution: {
    requested: TerminalTransportRenderer;
    effective: TerminalTransportRenderer;
    reason: 'configured' | 'supported' | 'unsupported';
  }): void;
  onError?(error: Error): void;
}

interface BridgeClientOptions {
  identity?: DeviceIdentityStore;
  cipher?: FrameCipher;
  socketFactory?: (url: string) => SocketLike;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  connectTimeoutMs?: number;
  scheduleConnectTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelConnectTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
  randomBytes?: (length: number) => Uint8Array;
  now?: () => number;
  callbacks?: BridgeClientCallbacks;
  performanceTrace?: MobilePerformanceTrace;
}

export class BridgeClient {
  private readonly identity: DeviceIdentityStore;
  private readonly cipher: FrameCipher;
  private readonly socketFactory: (url: string) => SocketLike;
  private readonly schedule: NonNullable<BridgeClientOptions['schedule']>;
  private readonly cancelSchedule: NonNullable<BridgeClientOptions['cancelSchedule']>;
  private readonly connectTimeoutMs: number;
  private readonly scheduleConnectTimeout: NonNullable<BridgeClientOptions['scheduleConnectTimeout']>;
  private readonly cancelConnectTimeout: NonNullable<BridgeClientOptions['cancelConnectTimeout']>;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly now: () => number;
  private readonly callbacks: BridgeClientCallbacks;
  private readonly performanceTrace: MobilePerformanceTrace;
  private socket: SocketLike | null = null;
  /** 并行拨号（2026-10-22）：尚未转正的直连竞速线。握手先到者转正，其余关闭。 */
  private readonly raceLosers = new Set<SocketLike>();
  /** 走 Relay 传输的 socket：只有它们会收到 Relay 控制帧（peer / error）。 */
  private readonly relaySockets = new WeakSet<SocketLike>();
  private readonly socketRecoveryGenerations = new WeakMap<SocketLike, number>();
  private profile: PairedDesktopProfile | null = null;
  private channel: EncryptedChannel | null = null;
  private transcript: Uint8Array | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private readonly recoveryOwner = new MobileConnectionRecoveryOwner();
  private readonly flapGuard = new MobileConnectionFlapGuard();
  private nextRecoveryReason: MobileConnectionRecoveryReason | null = null;
  private manuallyClosed = false;
  /**
   * `fatal` blocks even an explicit foreground: authorization was withdrawn,
   * the desktop identity did not verify, the pairing address is unusable, or
   * the app itself asked to disconnect. Everything else is worth another dial
   * once the user is actually looking at the phone.
   */
  private fault: 'none' | 'fatal' = 'none';
  private suspended = false;
  private incoming = Promise.resolve();
  private readonly sequencer: PtyEventSequencer;
  private readonly snapshotAssembler = new TerminalSnapshotAssembler();
  private readonly historyAssembler = new TerminalHistoryAssembler();
  private connectionOperationId: string | null = null;
  private readonly pendingCatalogs = new Set<'workspaceList' | 'panelList' | 'roomList'>();
  private readonly ptyIngressTimings = new Map<string, Omit<PtyIngressTiming, 'rnDispatchedAtMs'>>();
  private catalogReadyNotified = false;
  private livenessProbe: {
    requestId: string;
    timer: ReturnType<typeof setTimeout>;
    sentAtMs: number | null;
    /** One resend is allowed before the socket is declared dead. */
    retried: boolean;
  } | null = null;
  private socketOpenedAtMs: number | null = null;
  private relayReady = false;
  private relayEndpointIndex = 0;
  /** Platform failure text for the dial in flight. Diagnosis only; never persisted. */
  private socketErrorMessage: string | null = null;
  private connectTimedOut = false;
  private lastInboundAtMs = 0;
  private inboundWatchdog: ReturnType<typeof setTimeout> | null = null;
  private roundTripMs: number | null = null;
  private terminalRenderer: TerminalTransportRenderer = 'native-grid';
  private terminalGridCapability: boolean | null = null;
  private workspaceFilesCapability = false;
  private officePreviewCapability = false;
  /** The desktop advertised panel-states-v1 on this connection (MOBILE-SESSION-RUN-STATE-01). */
  private panelStatesCapability = false;
  private endpointSyncCapability = false;
  private lastEndpointUpdateAtMs = 0;
  /** ADR-003 §17 回退候选：桌面换址前的那组地址。新地址认证成功一次即丢弃。 */
  private fallbackEndpoint: { host: string; port: number } | null = null;
  /** 本轮拨号是否在试回退候选（仅未配 Relay 的档案使用）。 */
  private dialingFallback = false;
  private capabilityProbe: {
    promise: Promise<boolean>;
    resolve(supported: boolean): void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  state: BridgeConnectionState = 'disconnected';

  constructor(options: BridgeClientOptions = {}) {
    this.identity = options.identity ?? new DeviceIdentityStore();
    this.cipher = options.cipher ?? new ExpoFrameCipher();
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
    this.connectTimeoutMs = options.connectTimeoutMs ?? 8_000;
    this.scheduleConnectTimeout = options.scheduleConnectTimeout ?? ((callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      (timer as unknown as { unref?(): void }).unref?.();
      return timer;
    });
    this.cancelConnectTimeout = options.cancelConnectTimeout ?? ((timer) => clearTimeout(timer));
    if (!Number.isFinite(this.connectTimeoutMs) || this.connectTimeoutMs <= 0) {
      throw new Error('invalid connect timeout');
    }
    this.randomBytes = options.randomBytes ?? ((length) => Crypto.getRandomBytes(length));
    this.now = options.now ?? (() => performance.now());
    this.callbacks = options.callbacks ?? {};
    this.performanceTrace = options.performanceTrace ?? new MobilePerformanceTrace();
    this.sequencer = new PtyEventSequencer(
      (event) => {
        this.historyAssembler.acceptLive(event);
        const key = this.ptyIngressKey(event);
        const captured = this.ptyIngressTimings.get(key);
        this.ptyIngressTimings.delete(key);
        const rnDispatchedAtMs = this.now();
        this.callbacks.onPtyData?.(event, captured === undefined
          ? {
              socketReceivedAtMs: rnDispatchedAtMs,
              decryptedAtMs: rnDispatchedAtMs,
              rnDispatchedAtMs,
            }
          : { ...captured, rnDispatchedAtMs });
      },
      (panelId, expected, received) => {
        this.callbacks.onGap?.(panelId, expected, received);
        void this.attach(panelId).catch((error: unknown) => {
          this.callbacks.onError?.(error instanceof Error ? error : new Error('replay request failed'));
        });
      },
      (panelId, lines) => this.callbacks.onOutputLoss?.(panelId, lines),
      (panelId, lines) => this.callbacks.onOutputTrimmed?.(panelId, lines),
    );
  }

  connect(profile: PairedDesktopProfile, fallback?: { host: string; port: number } | null): void {
    const preserveSequence = samePairedDesktop(this.profile, profile);
    this.disconnect(false);
    if (!preserveSequence) {
      this.sequencer.reset();
      this.roundTripMs = null;
    }
    this.profile = profile;
    // ADR-003 §17：回退候选随档案一起进来；不合规的值直接丢，不参与拨号。
    this.fallbackEndpoint = fallback !== undefined
      ? (fallback !== null && isAcceptableDesktopEndpoint(fallback) ? fallback : null)
      : this.fallbackEndpoint;
    this.dialingFallback = false;
    this.manuallyClosed = false;
    this.suspended = false;
    this.reconnectAttempt = 0;
    this.fault = 'none';
    // An explicit reconnect is the user's own verdict on the connection; it
    // clears the flap run rather than inheriting it.
    this.flapGuard.reset();
    if (!isMobileBridgeIpv4(profile.host)
      && !(profile.relay !== undefined && isRelayOnlyPairingHost(profile.host))) {
      this.fault = 'fatal';
      this.setState('rejected');
      this.callbacks.onError?.(new Error('配对资料中的地址不是 Connect 支持的配对地址，请重新配对。'));
      return;
    }
    this.open(false);
  }

  performanceSnapshot(): MobilePerformanceMark[] {
    return this.performanceTrace.snapshot();
  }

  roundTripEstimateMs(): number | null {
    return this.roundTripMs;
  }

  disconnect(manual = true): void {
    this.manuallyClosed = manual;
    if (manual) this.fault = 'fatal';
    this.cancelActiveConnectionMarks();
    this.recoveryOwner.cancel();
    this.nextRecoveryReason = null;
    if (this.reconnectTimer !== null) {
      this.cancelSchedule(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectTimer();
    const socket = this.socket;
    this.abandonRaceLosers();
    this.socket = null;
    this.channel = null;
    this.transcript = null;
    this.socketOpenedAtMs = null;
    this.relayReady = false;
    this.relayEndpointIndex = 0;
    this.ptyIngressTimings.clear();
    this.snapshotAssembler.reset();
    this.historyAssembler.reset();
    this.clearLivenessProbe();
    this.clearInboundWatchdog();
    this.resetCapabilityProbe();
    this.flapGuard.forget();
    socket?.close(1000, 'client closing');
    this.setState('disconnected');
  }

  forgetProfile(): void {
    this.profile = null;
    this.disconnect();
    this.reconnectAttempt = 0;
    this.flapGuard.reset();
    this.sequencer.reset();
    this.roundTripMs = null;
  }

  suspend(): void {
    if (
      this.profile === null
      || this.suspended
      || this.manuallyClosed
      || this.state === 'rejected'
    ) return;
    this.suspended = true;
    this.cancelActiveConnectionMarks();
    this.recoveryOwner.cancel();
    this.nextRecoveryReason = null;
    if (this.reconnectTimer !== null) {
      this.cancelSchedule(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearConnectTimer();
    const socket = this.socket;
    this.abandonRaceLosers();
    this.socket = null;
    this.channel = null;
    this.transcript = null;
    this.socketOpenedAtMs = null;
    this.ptyIngressTimings.clear();
    this.snapshotAssembler.reset();
    this.historyAssembler.reset();
    this.clearLivenessProbe();
    this.clearInboundWatchdog();
    this.resetCapabilityProbe();
    // Backgrounding ends the session for reasons that say nothing about the
    // connection's health, so the run is dropped rather than counted.
    this.flapGuard.forget();
    socket?.close(1000, 'app backgrounded');
    this.setState('disconnected');
  }

  /**
   * The app is on screen again. Decides here, not at the call site: only this
   * object knows whether the socket was suspended, is still authenticated, or
   * is parked behind a backoff the OS froze.
   *
   * A `connected` state on return is a claim, not evidence — iOS routinely
   * kills the socket without ever delivering a close event, which is how the
   * phone ends up showing "在线" over a dead link. The probe rides the same
   * socket and `usePresentedConnection` hides its 700 ms, so a healthy return
   * still looks seamless while a dead one is caught in seconds.
   */
  foreground(backgroundMs?: number): void {
    if (this.profile === null || this.fault === 'fatal') return;
    if (this.suspended) {
      this.revive();
      return;
    }
    if (this.state === 'connected') {
      const quick = backgroundMs !== undefined && backgroundMs >= LONG_BACKGROUND_MS;
      void (quick
        ? this.confirmLiveness(
          Math.max(QUICK_LIVENESS_PROBE_TIMEOUT_MS, (this.roundTripMs ?? 0) * 3),
          false,
        )
        : this.confirmLiveness()
      ).catch(() => {});
      return;
    }
    // A dial already in flight is bounded by the connect timeout; restarting it
    // would only push the connection further away.
    if (
      this.state === 'connecting'
      || this.state === 'authenticating'
      || this.state === 'confirming'
      || (this.state === 'reconnecting' && this.recoveryOwner.snapshot().phase === 'dialing')
    ) return;
    this.revive();
  }

  private revive(): void {
    this.suspended = false;
    this.manuallyClosed = false;
    this.fault = 'none';
    this.reconnectAttempt = 0;
    // Opening the app outranks whatever the backoff was waiting for: take the
    // lease away from it rather than queueing behind a frozen timer.
    if (this.reconnectTimer !== null) {
      this.cancelSchedule(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.recoveryOwner.cancel();
    this.startRecovery('foreground', 0);
  }

  async confirmLiveness(
    timeoutMs = livenessProbeTimeoutMs(this.roundTripMs),
    retry = true,
  ): Promise<void> {
    if (this.state !== 'connected' || this.livenessProbe !== null) return;
    const requestId = createMobileRequestId();
    this.performanceTrace.record(requestId, 'connection', 'started');
    this.setState('confirming');
    this.performanceTrace.record(requestId, 'connection', 'local_feedback');
    const timer = this.armLivenessDeadline(requestId, timeoutMs);
    this.livenessProbe = { requestId, timer, sentAtMs: null, retried: !retry };
    try {
      const socket = this.socket;
      const channel = this.channel;
      if (!socket || !channel) throw new Error('mobile bridge is not connected');
      const frame = await channel.seal({ kind: 'heartbeat', requestId });
      socket.send(JSON.stringify(frame));
      if (this.livenessProbe?.requestId === requestId) {
        this.livenessProbe.sentAtMs = this.now();
      }
      this.performanceTrace.record(requestId, 'connection', 'request_sent');
    } catch (error) {
      this.clearLivenessProbe();
      this.performanceTrace.record(requestId, 'connection', 'failed', 'retryable');
      throw error;
    }
  }

  /**
   * Silence for one deadline means the heartbeat may simply have been dropped;
   * silence for two means the socket is gone. Only the second tears it down,
   * because a redial costs four round trips on the relay.
   */
  private armLivenessDeadline(
    requestId: string,
    timeoutMs: number,
  ): ReturnType<typeof setTimeout> {
    return this.schedule(() => {
      const probe = this.livenessProbe;
      if (probe?.requestId !== requestId) return;
      if (!probe.retried) {
        probe.retried = true;
        // A late reply to the first send still matches this requestId and ends
        // the probe; leaving `sentAtMs` null keeps it out of the RTT average,
        // where it would read as far faster than the link really is.
        probe.sentAtMs = null;
        probe.timer = this.armLivenessDeadline(requestId, timeoutMs);
        void this.resendLivenessProbe(requestId);
        return;
      }
      this.livenessProbe = null;
      this.performanceTrace.record(requestId, 'connection', 'failed', 'retryable');
      const socket = this.socket;
      if (socket === null) return;
      this.manuallyClosed = false;
      socket.close(1012, 'liveness probe timeout');
    }, timeoutMs);
  }

  private async resendLivenessProbe(requestId: string): Promise<void> {
    const socket = this.socket;
    const channel = this.channel;
    if (!socket || !channel) return;
    try {
      const frame = await channel.seal({ kind: 'heartbeat', requestId });
      if (this.livenessProbe?.requestId !== requestId) return;
      socket.send(JSON.stringify(frame));
    } catch {
      // The remaining deadline still governs; failing to resend is not itself
      // evidence that the socket is dead.
    }
  }

  async send(command: MobileCommand): Promise<void> {
    const socket = this.socket;
    const channel = this.channel;
    if (
      !socket
      || !channel
      || (
        this.state !== 'connected'
        && !(this.state === 'confirming' && command.kind === 'heartbeat')
      )
    ) throw new Error('mobile bridge is not connected');
    const frame = await channel.seal(command);
    socket.send(JSON.stringify(frame));
  }

  async attach(
    panelId: string,
    resetSequence = false,
    requestId = createMobileRequestId(),
    terminalRenderer: TerminalTransportRenderer = this.terminalRenderer,
  ): Promise<string> {
    if (resetSequence) this.sequencer.resetPanel(panelId);
    // Read before the capability probe is awaited. A reset asks the desktop to
    // replay from the beginning; live output arriving during the wait would
    // re-seed the cursor and quietly turn that into "just send me the tail".
    const afterSeq = this.sequencer.deliveredSeq(panelId);
    const supported = terminalRenderer === 'native-grid'
      ? await this.supportsTerminalGrid()
      : false;
    const effective: TerminalTransportRenderer = terminalRenderer === 'native-grid' && !supported
      ? 'legacy-webview'
      : terminalRenderer;
    this.callbacks.onTerminalRendererResolved?.({
      requested: terminalRenderer,
      effective,
      reason: terminalRenderer === 'legacy-webview'
        ? 'configured'
        : supported ? 'supported' : 'unsupported',
    });
    await this.send({
      kind: 'attach',
      requestId,
      panelId,
      afterSeq,
      viewportFirst: true,
      ...(effective === 'native-grid' ? { terminalRenderer: effective } : {}),
    });
    return requestId;
  }

  /**
   * Claims the shared PTY's geometry for this phone. The desktop only honours
   * it while this device holds input (`mobileBridgeServer.doResize`), and
   * callers must gate on `shouldSendPtyResize` before reaching here.
   */
  async resize(panelId: string, cols: number, rows: number): Promise<void> {
    await this.send({ kind: 'resize', panelId, cols, rows });
  }

  setTerminalRenderer(renderer: TerminalTransportRenderer): void {
    this.terminalRenderer = renderer;
  }

  async refreshTerminalGridSupport(): Promise<boolean> {
    if (this.state !== 'connected') throw new Error('mobile bridge is not connected');
    const probe = this.beginCapabilityProbe();
    try {
      await this.send({
        kind: 'listWorkspaces',
        requestId: MOBILE_CAPABILITY_PROBE_V2_REQUEST_ID,
      });
      return await probe;
    } catch (error) {
      this.finishCapabilityProbe(false);
      throw error;
    }
  }

  async queryOwnership(
    panelId: string,
    requestId = createMobileRequestId(),
  ): Promise<string> {
    await this.send({ kind: 'queryOwnership', requestId, panelId });
    return requestId;
  }

  async sendWrite(
    panelId: string,
    data: string,
    epoch: number,
    requestId?: string,
    paste = false,
  ): Promise<void> {
    await this.send({ kind: 'write', requestId, panelId, data, epoch, ...(paste ? { paste: true } : {}) });
  }

  async sendKey(
    panelId: string,
    key: TerminalKeyName,
    epoch: number,
    modifiers?: TerminalKeyModifiers,
    requestId?: string,
  ): Promise<void> {
    await this.send({ kind: 'sendKey', requestId, panelId, key, epoch, ...(modifiers ? { modifiers } : {}) });
  }

  async sendRawBytes(
    panelId: string,
    data: string,
    epoch: number,
    requestId?: string,
  ): Promise<void> {
    await this.send({ kind: 'writeBytes', requestId, panelId, data, epoch });
  }

  async sendMouse(
    panelId: string,
    input: {
      action: TerminalMouseAction;
      button?: TerminalMouseButton;
      column: number;
      row: number;
      modifiers?: TerminalKeyModifiers;
    },
    epoch: number,
    requestId?: string,
  ): Promise<void> {
    await this.send({ kind: 'mouse', requestId, panelId, epoch, ...input });
  }

  async requestCopy(
    panelId: string,
    mode: 'screen' | 'scrollback',
    requestId = createMobileRequestId(),
  ): Promise<string> {
    await this.send({ kind: 'copy', requestId, panelId, mode });
    return requestId;
  }

  private setState(state: BridgeConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks.onState?.(state);
  }

  /**
   * Watches for inbound silence rather than re-arming on every frame: a busy
   * panel delivers thousands of messages, and paying a timer swap for each one
   * would put the cost on exactly the sessions that need it least.
   */
  private armInboundWatchdog(): void {
    this.clearInboundWatchdog();
    this.lastInboundAtMs = this.now();
    this.scheduleInboundWatchdog(INBOUND_SILENCE_PROBE_MS);
  }

  private scheduleInboundWatchdog(delayMs: number): void {
    this.inboundWatchdog = this.schedule(() => {
      this.inboundWatchdog = null;
      // A probe is already in flight, or the link is between states. Wait out
      // another window rather than standing down: dropping the watchdog here
      // leaves the rest of the session with no silence detection at all, and a
      // frozen watchdog expiring right as the app foregrounds hits exactly that.
      if (this.state !== 'connected') {
        if (this.state === 'confirming') this.scheduleInboundWatchdog(INBOUND_SILENCE_PROBE_MS);
        return;
      }
      const silentForMs = this.now() - this.lastInboundAtMs;
      if (silentForMs < INBOUND_SILENCE_PROBE_MS) {
        this.scheduleInboundWatchdog(INBOUND_SILENCE_PROBE_MS - silentForMs);
        return;
      }
      this.scheduleInboundWatchdog(INBOUND_SILENCE_PROBE_MS);
      void this.confirmLiveness().catch(() => {});
    }, delayMs);
  }

  private clearInboundWatchdog(): void {
    const timer = this.inboundWatchdog;
    if (timer === null) return;
    this.inboundWatchdog = null;
    this.cancelSchedule(timer);
  }

  private clearLivenessProbe(): void {
    if (this.livenessProbe === null) return;
    this.cancelSchedule(this.livenessProbe.timer);
    this.livenessProbe = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer === null) return;
    this.cancelConnectTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private cancelActiveConnectionMarks(): void {
    if (this.connectionOperationId !== null) {
      this.performanceTrace.record(
        this.connectionOperationId,
        'connection',
        'cancelled',
        'retryable',
      );
      this.connectionOperationId = null;
    }
    if (this.livenessProbe !== null) {
      this.performanceTrace.record(
        this.livenessProbe.requestId,
        'connection',
        'cancelled',
        'retryable',
      );
    }
  }

  private startRecovery(reason: MobileConnectionRecoveryReason, delayMs: number): void {
    const lease = this.recoveryOwner.request(reason);
    if (!lease.started) return;
    this.setState('reconnecting');
    let handle: ReturnType<typeof setTimeout> | null = null;
    const begin = (): void => {
      // Only ever release this callback's own handle. A stale timer thawing
      // after a newer recovery took over used to null out the live handle,
      // leaving a dial nothing could cancel.
      if (handle !== null && this.reconnectTimer === handle) this.reconnectTimer = null;
      if (!this.recoveryOwner.beginDial(lease.generation)) return;
      this.open(true, lease.generation);
    };
    if (delayMs <= 0) {
      begin();
      return;
    }
    handle = this.schedule(begin, delayMs);
    this.reconnectTimer = handle;
  }

  private open(reconnecting: boolean, recoveryGeneration?: number): void {
    const profile = this.profile;
    if (!profile) return;
    this.setState(reconnecting ? 'reconnecting' : 'connecting');
    const operationId = createMobileRequestId();
    this.connectionOperationId = operationId;
    this.pendingCatalogs.clear();
    this.catalogReadyNotified = false;
    this.performanceTrace.record(operationId, 'connection', 'started');
    this.performanceTrace.record(operationId, 'connection', 'local_feedback');
    const relayCandidates = profile.relay === undefined
      ? []
      : [
          { url: profile.relay.url, apiKey: profile.relay.apiKey },
          ...(profile.relay.fallbacks ?? []),
        ];
    const relayEndpoint = relayCandidates.length === 0
      ? null
      : relayCandidates[this.relayEndpointIndex % relayCandidates.length];
    // ADR-003 §17：有回退候选且本轮在试它时拨旧地址；配了 Relay 的档案由 Relay 兜底，不用回退候选
    const directTarget = profile.relay === undefined
      && this.dialingFallback
      && this.fallbackEndpoint !== null
      ? this.fallbackEndpoint
      : profile;
    const socket = this.socketFactory(relayEndpoint?.url ?? `ws://${directTarget.host}:${directTarget.port}`);
    if (recoveryGeneration !== undefined) {
      this.socketRecoveryGenerations.set(socket, recoveryGeneration);
    }
    this.socket = socket;
    if (relayEndpoint !== null) this.relaySockets.add(socket);
    this.socketErrorMessage = null;
    this.connectTimedOut = false;
    this.clearConnectTimer();
    this.connectTimer = this.scheduleConnectTimeout(() => {
      if (socket !== this.socket || this.connectionOperationId !== operationId) return;
      this.connectTimer = null;
      this.connectTimedOut = true;
      this.nextRecoveryReason = 'socket_close';
      socket.close(1012, 'connect timeout');
    }, this.connectTimeoutMs);
    socket.onopen = () => {
      if (socket !== this.socket || this.connectionOperationId !== operationId) return;
      this.performanceTrace.record(operationId, 'connection', 'socket_open');
      this.socketOpenedAtMs = this.now();
      if (profile.relay) {
        this.relayReady = false;
        this.clearConnectTimer();
        this.connectTimer = this.scheduleConnectTimeout(() => {
          if (socket !== this.socket || this.connectionOperationId !== operationId) return;
          this.connectTimer = null;
          this.connectTimedOut = true;
          this.nextRecoveryReason = 'socket_close';
          socket.close(1012, 'relay peer wait timeout');
        }, RELAY_PEER_WAIT_MS);
        socket.send(JSON.stringify({
          v: 1,
          kind: 'join',
          role: 'mobile',
          ticket: profile.relay.ticket,
          ...(profile.relay.credential
            ? { credential: profile.relay.credential }
            : { apiKey: relayEndpoint?.apiKey ?? profile.relay.apiKey }),
        }));
      } else {
        this.relayReady = true;
        this.setState('authenticating');
      }
    };
    this.wireProtocolHandlers(socket, profile, operationId, recoveryGeneration);
    // 并行拨号（2026-10-22 方案）：配了 Relay 且档案 host 是真实私网 / Tailscale 地址时，
    // 同时拨直连；谁先送来协议握手帧（serverHello）用谁。Relay-only 档案的哑地址不参与。
    if (relayEndpoint !== null && isRaceableDirectHost(profile.host)) {
      const sibling = this.socketFactory(`ws://${profile.host}:${profile.port}`);
      if (recoveryGeneration !== undefined) this.socketRecoveryGenerations.set(sibling, recoveryGeneration);
      this.raceLosers.add(sibling);
      sibling.onopen = () => undefined; // 直连无 Relay 控制面：打开后等桌面主动发 serverHello
      this.wireProtocolHandlers(sibling, profile, operationId, recoveryGeneration);
    }
  }


  /** open() 的收发接线；并行拨号的直连线复用同一套处理，闭包绑定各自的 socket。 */
  private wireProtocolHandlers(
    socket: SocketLike,
    profile: PairedDesktopProfile,
    operationId: string,
    recoveryGeneration: number | undefined,
  ): void {
    socket.onmessage = (event) => {
      const socketReceivedAtMs = this.now();
      this.lastInboundAtMs = socketReceivedAtMs;
      // 中转可能把桌面发来的文本帧重发成二进制帧(RN 投递 ArrayBuffer),先还原再走协议。
      const text = socketDataToText(event.data);
      if (text === null) {
        this.failClosed(socket, new Error('invalid socket message'));
        return;
      }
      if (this.relaySockets.has(socket) && !this.relayReady) {
        let relay: Record<string, unknown> | null = null;
        try { relay = JSON.parse(text) as Record<string, unknown>; } catch { relay = null; }
        if (relay?.v === 1 && relay.kind === 'peer') {
          this.relayReady = true;
          // 对端到了，握手重新计 8 秒拨号上限。
          this.clearConnectTimer();
          this.connectTimer = this.scheduleConnectTimeout(() => {
            if (socket !== this.socket || this.connectionOperationId !== operationId) return;
            this.connectTimer = null;
            this.connectTimedOut = true;
            this.nextRecoveryReason = 'socket_close';
            socket.close(1012, 'connect timeout');
          }, this.connectTimeoutMs);
          this.setState('authenticating');
          return;
        }
        if (relay?.v === 1 && relay.kind === 'error') {
          // Relay 控制面的拒绝（桌面暂未挂号、旧 Relay 的票过期、名额被占）只说明这会儿没会合上，
          // 不是桌面的授权拒绝：等随之而来的 close，按普通退避重试，不提示「安全连接异常」。
          return;
        }
        this.failClosed(socket, new Error('relay handshake rejected'));
        return;
      }
      // 并行拨号：协议帧到达即裁决归属（主线到达→关掉竞速线；竞速线先到→转正）。
      if (!this.settleRace(socket, operationId)) return;
      this.incoming = this.incoming
        .then(() => this.handleMessage(socket, text, socketReceivedAtMs))
        .catch((error: unknown) => this.failClosed(socket, error));
    };
    // React Native 0.86.2 dispatches a bare `Event('error')` here and puts the
    // platform text on the close event's `reason` instead
    // (`Libraries/WebSocket/WebSocket.js:273-287`). Other environments do carry
    // a message, so read it when it exists — but `reason` is the real channel.
    socket.onerror = (event) => {
      if (socket !== this.socket) return;
      const message = event?.message;
      this.socketErrorMessage = typeof message === 'string' && message !== '' ? message : null;
    };
    socket.onclose = (event) => this.handleClose(socket, event, recoveryGeneration);
  }

  /**
   * 并行拨号的裁决：返回 false 表示这帧来自已落败的线，应丢弃。
   * 主线收到协议帧 → 关掉所有竞速线；竞速线先收到 → 转正为主线、关掉原主线、重计握手时限。
   */
  private settleRace(socket: SocketLike, operationId: string): boolean {
    if (this.connectionOperationId !== operationId) return socket === this.socket;
    if (socket === this.socket) {
      this.abandonRaceLosers();
      return true;
    }
    if (!this.raceLosers.has(socket)) return false;
    this.raceLosers.delete(socket);
    const previous = this.socket;
    this.socket = socket;
    this.abandonRaceLosers();
    previous?.close(1012, 'raced out');
    this.armHandshakeTimeout(socket, operationId);
    this.setState('authenticating');
    return true;
  }

  private armHandshakeTimeout(socket: SocketLike, operationId: string): void {
    this.clearConnectTimer();
    this.connectTimer = this.scheduleConnectTimeout(() => {
      if (socket !== this.socket || this.connectionOperationId !== operationId) return;
      this.connectTimer = null;
      this.connectTimedOut = true;
      this.nextRecoveryReason = 'socket_close';
      socket.close(1012, 'connect timeout');
    }, this.connectTimeoutMs);
  }

  /** 一轮拨号结束或胜负已分：未转正的竞速线一律关闭（其 close 事件因不是主线而被忽略）。 */
  private abandonRaceLosers(): void {
    for (const loser of this.raceLosers) {
      this.raceLosers.delete(loser);
      try { loser.close(1012, 'raced out'); } catch { /* 已关闭 */ }
    }
  }
  private async handleMessage(
    socket: SocketLike,
    data: unknown,
    socketReceivedAtMs = this.now(),
  ): Promise<void> {
    if (socket !== this.socket || typeof data !== 'string') throw new Error('invalid socket message');
    const profile = this.profile;
    if (!profile) throw new Error('pairing profile unavailable');

    if (this.channel === null) {
      const parsed = JSON.parse(data) as unknown;
      if (this.transcript === null) {
        const hello = parseServerHello(parsed);
        const ephemeral = generateX25519KeyPair(() => this.randomBytes(32));
        const nonce = this.randomBytes(32);
        const phoneEphemeralPubKey = x25519PublicKeyToSpki(ephemeral.publicKey);
        const transcript = buildTranscript({
          deviceId: profile.deviceId,
          phoneEphemeralPubKey,
          desktopEphemeralPubKey: hello.ephemeralPubKey,
          nonce,
        });
        try {
          const signature = await this.identity.sign(transcript);
          // Signing can outlive the socket it belongs to: iOS freezes the app
          // mid-handshake, the app foregrounds onto a fresh socket, and only
          // then does this resume. Writing the dead socket's channel back would
          // make the new socket's serverHello parse as a serverAuth and cost a
          // whole extra dial.
          if (socket !== this.socket || this.profile !== profile) return;
          const keys = deriveSessionKeys({
            phonePrivateKey: ephemeral.privateKey,
            desktopPublicKeySpki: hello.ephemeralPubKey,
            transcript,
          });
          this.channel = new EncryptedChannel(
            profile.deviceId,
            keys.sendKey,
            keys.receiveKey,
            this.cipher,
          );
          this.transcript = transcript;
          socket.send(JSON.stringify({
            v: MOBILE_PROTOCOL_VERSION,
            deviceId: profile.deviceId,
            ephemeralPubKey: phoneEphemeralPubKey,
            nonce: bytesToBase64(nonce),
            signature,
          }));
        } finally {
          ephemeral.privateKey.fill(0);
        }
        return;
      }
    }

    if (this.state === 'authenticating' && this.transcript !== null) {
      const auth = parseServerAuth(JSON.parse(data) as unknown);
      const trustedDesktopKey = ed25519PublicKeyFromSpki(profile.desktopIdentityPubKey);
      if (!verifyEd25519(base64ToBytes(auth.signature), this.transcript, trustedDesktopKey)) {
        throw new Error('desktop identity verification failed');
      }
      // Deliberately does not reset the backoff. A handshake proves the desktop
      // answered, not that the session will last; resetting here is what turned
      // a session that died a second later into a one-per-second storm.
      this.flapGuard.authenticated(this.now());
      this.relayEndpointIndex = 0;
      // ADR-003 §17：当前连接拨的是新地址（本轮没在试回退候选），新地址证实可用 → 丢弃后备
      if (this.fallbackEndpoint !== null && !this.dialingFallback) {
        this.fallbackEndpoint = null;
        this.callbacks.onFallbackCleared?.();
      }
      this.armInboundWatchdog();
      if (this.socketOpenedAtMs !== null) {
        this.observeRoundTrip(this.now() - this.socketOpenedAtMs);
        this.socketOpenedAtMs = null;
      }
      const recoveryGeneration = this.socketRecoveryGenerations.get(socket);
      if (recoveryGeneration !== undefined) {
        this.recoveryOwner.finish(recoveryGeneration);
      }
      this.setState('connected');
      // 每条新连接都可能连到另一版本的桌面（回滚、重装）：探针回答之前不得沿用上一条连接的文件能力，
      // 否则旧桌面会以 1008 断开未知的文件命令。
      this.officePreviewCapability = false;
      if (this.workspaceFilesCapability) {
        this.workspaceFilesCapability = false;
        this.callbacks.onServerCapabilities?.({ terminalGrid: false, workspaceFiles: false, answered: false });
      }
      this.beginCapabilityProbe();
      if (this.connectionOperationId !== null) {
        this.performanceTrace.record(
          this.connectionOperationId,
          'connection',
          'authenticated',
          'ok',
        );
        this.pendingCatalogs.clear();
        this.pendingCatalogs.add('workspaceList');
        this.pendingCatalogs.add('panelList');
        this.pendingCatalogs.add('roomList');
      }
      for (const kind of INITIAL_MOBILE_CATALOG_COMMAND_KINDS) {
        await this.send({ kind, requestId: createMobileRequestId() });
      }
      await this.send({
        kind: 'listWorkspaces',
        requestId: MOBILE_CAPABILITY_PROBE_V2_REQUEST_ID,
      });
      return;
    }

    if (!this.channel) throw new Error('encrypted channel unavailable');
    // Everything above this line is the secure channel itself — a failure there
    // is a security event and fails closed. Below it the peer is authenticated
    // and the frame is authentic; a payload this build cannot render is a
    // version or capability problem, and tearing the channel down over it only
    // reconnects into the same payload.
    const openedEvent = await this.channel.open(data);
    let parsedEvent: MobileEvent;
    try {
      parsedEvent = parseMobileEvent(openedEvent);
    } catch (error) {
      this.rejectPayload(openedEvent, error);
      return;
    }
    if (parsedEvent.kind === 'workspaceList') this.observeCapabilityProbe(parsedEvent);
    const decryptedAtMs = this.now();
    let event: MobileEvent;
    try {
      if (parsedEvent.kind === 'ptyReplayAbort') {
        this.snapshotAssembler.abort(parsedEvent.panelId);
        event = parsedEvent;
      } else if (parsedEvent.kind === 'ptyHistoryAbort') {
        this.historyAssembler.abort(parsedEvent.panelId);
        return;
      } else if (
        parsedEvent.kind === 'ptyHistoryStart'
        || parsedEvent.kind === 'ptyHistoryChunk'
        || parsedEvent.kind === 'ptyHistoryCommit'
      ) {
        const history = this.historyAssembler.accept(parsedEvent);
        if (history !== null) this.callbacks.onPtyHistory?.(history);
        return;
      } else if (
        parsedEvent.kind === 'ptyReplayStart'
        || parsedEvent.kind === 'ptyReplayChunk'
        || parsedEvent.kind === 'ptyReplayCommit'
      ) {
        const assembled = this.snapshotAssembler.accept(parsedEvent);
        if (assembled === null) return;
        event = assembled;
      } else {
        if (
          parsedEvent.kind === 'ptyReplay'
          || parsedEvent.kind === 'ptyData'
          || parsedEvent.kind === 'ptyExit'
          || parsedEvent.kind === 'attachReady'
        ) this.snapshotAssembler.assertIdle();
        if (parsedEvent.kind === 'ptyExit') this.historyAssembler.abort(parsedEvent.id);
        event = parsedEvent;
      }
      // A replay whose bounds or loss counters contradict what this phone
      // already holds is the same class of problem: reset this panel's cursor
      // and re-attach rather than dropping the whole channel.
      if (event.kind === 'ptyReplay') this.sequencer.acceptReplay(event);
    } catch (error) {
      this.rejectPayload(parsedEvent, error);
      return;
    }
    if (
      event.kind === 'workspaceList'
      || event.kind === 'panelList'
      || event.kind === 'roomList'
    ) {
      this.pendingCatalogs.delete(event.kind);
      if (this.pendingCatalogs.size === 0 && this.connectionOperationId !== null) {
        this.clearConnectTimer();
        this.performanceTrace.record(
          this.connectionOperationId,
          'connection',
          'catalog_ready',
          'ok',
        );
        this.performanceTrace.record(
          this.connectionOperationId,
          'connection',
          'completed',
          'ok',
        );
        this.connectionOperationId = null;
      }
    }
    if (event.kind === 'endpointInfo') {
      this.observeEndpoint(event);
      return;
    }
    this.callbacks.onEvent?.(event);
    if (
      (event.kind === 'workspaceList' || event.kind === 'panelList' || event.kind === 'roomList')
      && this.pendingCatalogs.size === 0
      && this.connectionOperationId === null
      && !this.catalogReadyNotified
    ) {
      this.catalogReadyNotified = true;
      this.callbacks.onCatalogReady?.();
    }
    if (
      event.kind === 'error'
      && event.code === 'device_revoked'
      && event.category === 'action_required'
    ) {
      this.callbacks.onAuthorizationRejected?.();
    }
    if (event.kind === 'ptyData') {
      const key = this.ptyIngressKey(event);
      this.ptyIngressTimings.set(key, { socketReceivedAtMs, decryptedAtMs });
      while (this.ptyIngressTimings.size > 512) {
        const oldest = this.ptyIngressTimings.keys().next().value;
        if (oldest === undefined) break;
        this.ptyIngressTimings.delete(oldest);
      }
      this.sequencer.accept(event);
    }
    if (event.kind === 'heartbeat') {
      if (
        event.requestId !== undefined
        && this.livenessProbe?.requestId === event.requestId
      ) {
        const sentAtMs = this.livenessProbe.sentAtMs;
        if (sentAtMs !== null) this.observeRoundTrip(this.now() - sentAtMs);
        this.clearLivenessProbe();
        this.performanceTrace.record(event.requestId, 'connection', 'accepted', 'ok');
        this.performanceTrace.record(event.requestId, 'connection', 'completed', 'ok');
        this.setState('connected');
      } else if (event.requestId === undefined) {
        await this.send({ kind: 'heartbeat' });
      }
    }
  }

  /**
   * Records an authentic frame this build could not use, and clears the local
   * state that frame would have advanced so the panel can be re-synchronised.
   *
   * The report carries structured labels only — a kind, a panel and the
   * validator's own reason string. No PTY content ever leaves here.
   */
  private rejectPayload(value: unknown, error: unknown): void {
    const failure = error instanceof Error ? error : new Error('invalid mobile payload');
    const kind = isObject(value) && typeof value.kind === 'string' ? value.kind : 'unknown';
    const candidate = isObject(value)
      ? (typeof value.panelId === 'string' ? value.panelId
        : typeof value.id === 'string' ? value.id : null)
      : null;
    const panelId = candidate !== null && PANEL_ID_RE.test(candidate) ? candidate : null;
    console.warn('[ConnectMobile] rejected mobile payload:', kind, failure.message);
    if (panelId !== null) {
      this.snapshotAssembler.abort(panelId);
      this.historyAssembler.abort(panelId);
      this.sequencer.resetPanel(panelId);
    }
    this.callbacks.onPayloadRejected?.({ kind, panelId, reason: failure.message });
  }

  private ptyIngressKey(event: PtyDataEvent): string {
    return `${event.id}:${event.seq}`;
  }

  private observeRoundTrip(sampleMs: number): void {
    if (!Number.isFinite(sampleMs) || sampleMs <= 0) return;
    this.roundTripMs = this.roundTripMs === null
      ? sampleMs
      : this.roundTripMs * 0.7 + sampleMs * 0.3;
  }

  private failClosed(socket: SocketLike, error: unknown): void {
    if (socket !== this.socket) return;
    const failure = error instanceof Error ? error : new Error('mobile bridge rejected');
    if (failure.message.startsWith('invalid terminal grid frame:')) {
      console.warn('[ConnectMobile] secure channel reset:', failure.message);
    }
    const identityFailure = failure instanceof IdentityAccessError
      || failure.message === 'desktop identity verification failed';
    // A keychain the locked device would not open is `action_required`, not a
    // broken identity. `manuallyClosed` still keeps it out of the automatic
    // loop — retrying against a locked device is its own storm — but it is not
    // fatal, so an explicit foreground, which only happens once the device is
    // provably unlocked, may try again.
    const identityUnusable = identityFailure
      && !(failure instanceof IdentityAccessError && failure.category === 'action_required');
    this.manuallyClosed = identityFailure;
    if (identityUnusable) this.fault = 'fatal';
    this.nextRecoveryReason = identityFailure ? null : 'secure_channel';
    this.snapshotAssembler.reset();
    this.historyAssembler.reset();
    this.clearLivenessProbe();
    this.clearInboundWatchdog();
    this.resetCapabilityProbe();
    this.setState(
      identityUnusable ? 'rejected' : identityFailure ? 'disconnected' : 'reconnecting',
    );
    this.callbacks.onError?.(failure);
    socket.close(
      identityUnusable ? POLICY_CLOSE : 1012,
      failure.message === 'desktop identity verification failed'
        ? 'desktop identity changed'
        : identityFailure
          ? 'device identity unavailable'
          : 'secure channel reset',
    );
  }

  private handleClose(
    socket: SocketLike,
    event: { code: number; reason?: string },
    recoveryGeneration?: number,
  ): void {
    if (socket !== this.socket) return;
    // 并行拨号：主线（多为 Relay）在握手前断了，而直连线还在拨——由直连线顶上，不算这一轮失败。
    if (this.channel === null && !this.manuallyClosed && this.raceLosers.size > 0 && this.connectionOperationId !== null) {
      const next = this.raceLosers.values().next().value as SocketLike;
      this.raceLosers.delete(next);
      this.socket = next;
      this.relayReady = false;
      this.armHandshakeTimeout(next, this.connectionOperationId);
      return;
    }
    this.clearConnectTimer();
    if (recoveryGeneration !== undefined) {
      this.recoveryOwner.finish(recoveryGeneration);
    }
    if (this.connectionOperationId !== null) {
      this.performanceTrace.record(
        this.connectionOperationId,
        'connection',
        'failed',
        event.code === POLICY_CLOSE ? 'action_required' : 'retryable',
      );
      this.connectionOperationId = null;
    }
    const stateAtClose = this.state;
    const relayWasReady = this.relayReady;
    const recoveryReason = this.nextRecoveryReason
      ?? (stateAtClose === 'confirming' ? 'liveness' : 'socket_close');
    this.nextRecoveryReason = null;
    const livenessRequestId = this.livenessProbe?.requestId;
    // Read the dial's own outcome before the fields are cleared for the next one.
    const neverOpened = this.socketOpenedAtMs === null;
    // A dial that never opened means the desktop never spoke, so `reason` here
    // is the platform's own failure text rather than any application reason.
    const closeReason = typeof event.reason === 'string' && event.reason !== ''
      ? event.reason
      : null;
    const failureKind = classifyMobileConnectFailure({
      platformMessage: closeReason ?? this.socketErrorMessage,
      timedOut: this.connectTimedOut,
    });
    const failureHost = this.profile?.host ?? '';
    this.socketErrorMessage = null;
    this.connectTimedOut = false;
    this.abandonRaceLosers();
    this.socket = null;
    this.channel = null;
    this.transcript = null;
    this.socketOpenedAtMs = null;
    this.relayReady = false;
    if (this.profile?.relay && !relayWasReady) {
      const count = 1 + (this.profile.relay.fallbacks?.length ?? 0);
      this.relayEndpointIndex = (this.relayEndpointIndex + 1) % count;
    } else if (this.profile !== null && this.fallbackEndpoint !== null) {
      // ADR-003 §17：新地址失败 → 下一轮试旧地址；旧地址也失败 → 回到新地址
      this.dialingFallback = !this.dialingFallback;
    }
    this.ptyIngressTimings.clear();
    this.snapshotAssembler.reset();
    this.historyAssembler.reset();
    this.clearLivenessProbe();
    this.clearInboundWatchdog();
    this.resetCapabilityProbe();
    if (livenessRequestId !== undefined) {
      this.performanceTrace.record(livenessRequestId, 'connection', 'failed', 'retryable');
    }
    // Settle the lifetime for every close, retried or not, so the next session
    // is never judged against a timestamp this one left behind.
    const lifetime = this.flapGuard.closed(this.now());
    // Relay 会合阶段（还没见到对端）的 1008 来自 Relay 而不是桌面，按可重试处理（2026-10-20）。
    const relayControlClose = this.profile?.relay !== undefined && !relayWasReady;
    if (!(relayControlClose && !this.manuallyClosed && event.code === POLICY_CLOSE)
      && !shouldRetryClose({ code: event.code, manual: this.manuallyClosed })) {
      this.recoveryOwner.cancel();
      const authorizationRejected = (
        event.code === POLICY_CLOSE
        && (stateAtClose === 'authenticating' || event.reason === 'device revoked')
      );
      if (event.code === POLICY_CLOSE) {
        // The desktop reserves this code for authorization rejection and
        // protocol violation; neither is something to dial back into.
        this.fault = 'fatal';
        this.setState('rejected');
      } else this.setState('disconnected');
      if (authorizationRejected) this.callbacks.onAuthorizationRejected?.();
      return;
    }
    if (lifetime === 'stable') this.reconnectAttempt = 0;
    if (this.flapGuard.tripped) {
      // Saying "正在重连" while dialling into the same failure every few seconds
      // is neither honest nor useful. Stop, and hand the user something to act on.
      this.recoveryOwner.cancel();
      this.manuallyClosed = true;
      this.setState('disconnected');
      this.callbacks.onError?.(new MobileConnectionUnstableError());
      return;
    }
    // A dial that never opened is the case the user has no other signal for:
    // the retry banner alone says "connecting" while the real cause — no route,
    // nothing listening, no answer — stays invisible. Say which one it was.
    if (neverOpened) {
      this.callbacks.onError?.(new MobileConnectFailureError(failureKind, failureHost));
    }
    const delay = reconnectDelayMs(this.reconnectAttempt, 500, this.flapGuard.backoffCapMs());
    this.reconnectAttempt += 1;
    this.startRecovery(recoveryReason, delay);
  }

  /**
   * 探针 v2 的回复带 capabilities 即完成；不带说明是旧桌面（它把 v2 当普通请求），
   * 随即补发 v1 探针保住原生网格——旧桌面认得 v1，且 v1 的回复永远不含文件能力。
   */
  private observeCapabilityProbe(event: Extract<MobileEvent, { kind: 'workspaceList' }>): void {
    if (event.requestId === MOBILE_CAPABILITY_PROBE_V2_REQUEST_ID) {
      if (event.capabilities === undefined) {
        // 探针已超时判为不支持时仍补发 v1：慢链路上的旧桌面也能把原生网格找回来。
        if (this.capabilityProbe === null && this.terminalGridCapability !== false) return;
        void this.send({ kind: 'listWorkspaces', requestId: MOBILE_CAPABILITY_PROBE_REQUEST_ID })
          .catch(() => this.finishCapabilityProbe(false));
        return;
      }
      this.finishCapabilityProbe(
        event.capabilities.includes('terminal-grid-v1'),
        event.capabilities.includes('workspace-files-v1'),
        true,
        event.capabilities.includes('workspace-office-preview-v1'),
      );
      this.panelStatesCapability = event.capabilities.includes('panel-states-v1');
      // Watching is per connection on the desktop: ask again on every connection
      // that advertises it, and never on one that does not (an older Mac closes
      // the socket on an unknown command).
      if (this.panelStatesCapability) {
        void this.send({ kind: 'watchPanelStates', requestId: createMobileRequestId() }).catch(() => undefined);
      }
      this.endpointSyncCapability = event.capabilities.includes('endpoint-sync-v1');
      if (this.endpointSyncCapability) {
        void this.send({ kind: 'endpointSync', requestId: createMobileRequestId() }).catch(() => undefined);
      }
      return;
    }
    if (event.requestId === MOBILE_CAPABILITY_PROBE_REQUEST_ID) {
      this.finishCapabilityProbe(event.capabilities?.includes('terminal-grid-v1') === true, false, true);
    }
  }

  get supportsWorkspaceFiles(): boolean {
    return this.workspaceFilesCapability;
  }

  /** 桌面声明了 panel-states-v1：才可以发 markPanelRead；旧桌面会以 1008 断开未知命令。 */
  get supportsPanelStates(): boolean {
    return this.panelStatesCapability;
  }

  /** 桌面声明了 workspace-office-preview-v1：openFile 才可以带 acceptContentKinds: ['office']。 */
  get supportsOfficePreview(): boolean {
    return this.workspaceFilesCapability && this.officePreviewCapability;
  }

  private beginCapabilityProbe(): Promise<boolean> {
    this.resetCapabilityProbe();
    let resolve!: (supported: boolean) => void;
    const promise = new Promise<boolean>((settle) => { resolve = settle; });
    const timer = this.schedule(
      () => this.finishCapabilityProbe(false),
      terminalCapabilityProbeTimeoutMs(this.roundTripMs),
    );
    this.capabilityProbe = { promise, resolve, timer };
    return promise;
  }

  private finishCapabilityProbe(
    supported: boolean,
    workspaceFiles = false,
    answered = false,
    officePreview = false,
  ): void {
    const probe = this.capabilityProbe;
    this.terminalGridCapability = supported;
    this.workspaceFilesCapability = workspaceFiles;
    this.officePreviewCapability = workspaceFiles && officePreview;
    this.callbacks.onServerCapabilities?.({ terminalGrid: supported, workspaceFiles, answered });
    if (probe === null) return;
    this.capabilityProbe = null;
    this.cancelSchedule(probe.timer);
    probe.resolve(supported);
  }

  private resetCapabilityProbe(): void {
    const probe = this.capabilityProbe;
    this.capabilityProbe = null;
    this.terminalGridCapability = null;
    this.panelStatesCapability = false;
    this.endpointSyncCapability = false;
    if (probe === null) return;
    this.cancelSchedule(probe.timer);
    probe.resolve(false);
  }

  private supportsTerminalGrid(): Promise<boolean> {
    if (this.terminalGridCapability !== null) {
      return Promise.resolve(this.terminalGridCapability);
    }
    return this.capabilityProbe?.promise ?? Promise.resolve(false);
  }

  /**
   * ADR-003 §17：桌面告知新地址。null 忽略；非移动桥白名单地址拒绝；与当前档案相同跳过；
   * 5 秒内的重复更新限频；否则采纳（更新内存档案的 host/port）并回调 App 以持久化。
   */
  private observeEndpoint(event: Extract<MobileEvent, { kind: 'endpointInfo' }>): void {
    const profile = this.profile;
    if (profile === null || event.endpoint === null) return;
    const { host, port } = event.endpoint;
    if (!isMobileBridgeIpv4(host)) return;
    if (profile.host === host && profile.port === port) return;
    const nowMs = this.now();
    if (this.lastEndpointUpdateAtMs !== 0 && nowMs - this.lastEndpointUpdateAtMs < ENDPOINT_UPDATE_MIN_INTERVAL_MS) {
      return;
    }
    this.lastEndpointUpdateAtMs = nowMs;
    const previous = { host: profile.host, port: profile.port };
    // 旧真实地址留作回退候选；占位地址（Relay-only 档案）不留
    this.fallbackEndpoint = isMobileBridgeIpv4(previous.host) ? previous : null;
    this.dialingFallback = false;
    this.profile = { ...profile, host, port };
    this.callbacks.onEndpointChanged?.(
      { deviceId: profile.deviceId, desktopIdentityPubKey: profile.desktopIdentityPubKey },
      { host, port },
    );
  }
}
