import { t } from '../i18n';
import { base64ToBytes, concatBytes } from '../net/bytes';
import type { MobileCommand, MobileEvent } from '../net/bridgeClient';
import type {
  MobileFileContentKind,
  MobileFileEntry,
  MobileFileMutation,
  MobileFileMutationOp,
} from '../../../../src/shared/types';

/**
 * ADR-003 §14 工作区文件的手机端协议协调器：按 requestId 认领自己的回复与错误，
 * 不让文件错误落进 App 的「归到当前面板」兜底分支。界面无关，iPhone 与 iPad 共用。
 *
 * 写操作断线或超时一律 ambiguous：桌面可能已经执行（复制可能已部分落盘），
 * 这里绝不自动重试，只把「刷新后查看」交给用户。
 */

const READ_TIMEOUT_MS = 20_000;
const WRITE_TIMEOUT_MS = 30_000;

export type WorkspaceFileErrorCategory = 'retryable' | 'action_required' | 'permanent' | 'ambiguous';

export class WorkspaceFileError extends Error {
  constructor(
    readonly code: string,
    readonly category: WorkspaceFileErrorCategory,
    message: string,
  ) {
    super(message);
  }
}

/** 桌面没有声明 workspace-files-v1：命令根本不发出（旧桌面会以 1008 断开未知命令）。 */
export class WorkspaceFilesUnsupportedError extends Error {}

/** 超时或断线后才到的回复要吞掉，不能落进 App 的通用错误分支；有界，只记最近的。 */
const ABANDONED_LIMIT = 64;

/** 新的打开取代旧的下载（桌面每连接只保留一个下载句柄）；界面应静默忽略。 */
export class WorkspaceFileDownloadSupersededError extends Error {}

export interface WorkspaceFileListing {
  entries: MobileFileEntry[];
  truncated: boolean;
}

export interface WorkspaceFileContent {
  subPath: string;
  contentKind: MobileFileContentKind;
  byteLength: number;
  mime?: string;
  /** 只有 text 与可预览媒体才有；已按桌面给出的 sha256 校验。 */
  bytes?: Uint8Array;
  /** 与 bytes 同一份内容的 base64（768 KiB 块是 3 的倍数，块串直接拼接即整体编码），供 data URI 预览。 */
  base64?: string;
  /** 文本的 revision（保存时的 expectedRevision）。 */
  sha256?: string;
}

type FileEvent = Extract<MobileEvent, {
  kind: 'fileList' | 'fileOpened' | 'fileChunk' | 'fileMutationAccepted' | 'fileSaved' | 'error';
}>;

interface Pending {
  expected: FileEvent['kind'];
  write: boolean;
  resolve(event: FileEvent): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkspaceFileTransportOptions {
  send(command: MobileCommand): Promise<void>;
  requestId(): string;
  digest(bytes: Uint8Array): Promise<string>;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
  /** 当前连接的桌面是否声明了 workspace-office-preview-v1；每次 openFile 时现查。 */
  acceptsOffice?: () => boolean;
}

export class WorkspaceFileTransport {
  private readonly pending = new Map<string, Pending>();
  private readonly abandoned = new Set<string>();
  private readonly schedule: NonNullable<WorkspaceFileTransportOptions['schedule']>;
  private readonly cancelSchedule: NonNullable<WorkspaceFileTransportOptions['cancelSchedule']>;
  private downloadGeneration = 0;

  constructor(private readonly options: WorkspaceFileTransportOptions) {
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  }

  handle(event: MobileEvent): boolean {
    if (!('requestId' in event) || event.requestId === undefined) return false;
    const pending = this.pending.get(event.requestId);
    if (pending === undefined) return this.abandoned.delete(event.requestId);
    this.pending.delete(event.requestId);
    this.cancelSchedule(pending.timer);
    if (event.kind === 'error') {
      // 桌面的 message 固定是简体中文；手机按 code 用自己的语言说明，不直接转述。
      pending.reject(new WorkspaceFileError(event.code, event.category, fileErrorMessage(event.code, event.category)));
      return true;
    }
    if (event.kind !== pending.expected) {
      pending.reject(new WorkspaceFileError('file_unexpected_reply', 'retryable', t('电脑的回复无法识别，请重试。')));
      return true;
    }
    pending.resolve(event as FileEvent);
    return true;
  }

  cancelForDisconnect(): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      this.abandon(requestId);
      this.cancelSchedule(pending.timer);
      pending.reject(pending.write
        ? new WorkspaceFileError('file_write_unconfirmed', 'ambiguous', t('连接中断，电脑上的结果无法确认，请刷新后查看。'))
        : new WorkspaceFileError('file_disconnected', 'retryable', t('连接中断，恢复后请重试。')));
    }
  }

  async list(workspaceCapability: string, subPath: string): Promise<WorkspaceFileListing> {
    const event = await this.request('fileList', false, (requestId) => ({
      kind: 'listFiles', requestId, workspaceCapability, subPath,
    })) as Extract<FileEvent, { kind: 'fileList' }>;
    return { entries: event.entries, truncated: event.truncated };
  }

  async download(
    workspaceCapability: string,
    subPath: string,
    onProgress?: (received: number, total: number) => void,
    /** 返回 false 时只取元数据（如手机不能播放的音视频），不拉内容。 */
    shouldFetch: (contentKind: MobileFileContentKind) => boolean = () => true,
  ): Promise<WorkspaceFileContent> {
    const generation = ++this.downloadGeneration;
    const acceptOffice = this.options.acceptsOffice?.() === true;
    const opened = await this.request('fileOpened', false, (requestId) => ({
      kind: 'openFile',
      requestId,
      workspaceCapability,
      subPath,
      ...(acceptOffice ? { acceptContentKinds: ['office'] as ['office'] } : {}),
    })) as Extract<FileEvent, { kind: 'fileOpened' }>;
    const base: WorkspaceFileContent = {
      subPath,
      contentKind: opened.contentKind,
      byteLength: opened.byteLength,
      ...(opened.mime === undefined ? {} : { mime: opened.mime }),
      ...(opened.sha256 === undefined ? {} : { sha256: opened.sha256 }),
    };
    if (opened.fileCapability === undefined) {
      return opened.sha256 === undefined ? base : { ...base, bytes: new Uint8Array(0), base64: '' };
    }
    if (!shouldFetch(opened.contentKind)) return base;
    const parts: Uint8Array[] = [];
    const encoded: string[] = [];
    let received = 0;
    onProgress?.(0, opened.byteLength);
    for (let index = 0; index < opened.chunkCount; index += 1) {
      if (generation !== this.downloadGeneration) throw new WorkspaceFileDownloadSupersededError();
      const chunk = await this.request('fileChunk', false, (requestId) => ({
        kind: 'readFileChunk', requestId, fileCapability: opened.fileCapability!, index,
      })) as Extract<FileEvent, { kind: 'fileChunk' }>;
      if (chunk.index !== index || chunk.complete !== (index === opened.chunkCount - 1)) {
        throw new WorkspaceFileError('file_chunk_mismatch', 'retryable', t('文件传输顺序异常，请重新打开。'));
      }
      const bytes = base64ToBytes(chunk.data);
      parts.push(bytes);
      encoded.push(chunk.data);
      received += bytes.byteLength;
      onProgress?.(received, opened.byteLength);
    }
    if (generation !== this.downloadGeneration) throw new WorkspaceFileDownloadSupersededError();
    const bytes = concatBytes(...parts);
    if (bytes.byteLength !== opened.byteLength || await this.options.digest(bytes) !== opened.sha256) {
      throw new WorkspaceFileError('file_integrity_failed', 'retryable', t('文件校验未通过，请重新打开。'));
    }
    return { ...base, bytes, base64: encoded.join('') };
  }

  async mutate(
    workspaceCapability: string,
    mutation: MobileFileMutation,
  ): Promise<{ op: MobileFileMutationOp; name?: string }> {
    const event = await this.request('fileMutationAccepted', true, (requestId) => ({
      kind: 'mutateFile', requestId, workspaceCapability, ...mutation,
    }) as MobileCommand) as Extract<FileEvent, { kind: 'fileMutationAccepted' }>;
    return { op: event.op, ...(event.name === undefined ? {} : { name: event.name }) };
  }

  async save(
    workspaceCapability: string,
    subPath: string,
    expectedRevision: string,
    content: string,
  ): Promise<{ revision: string; byteLength: number }> {
    const event = await this.request('fileSaved', true, (requestId) => ({
      kind: 'saveFile', requestId, workspaceCapability, subPath, expectedRevision, content,
    })) as Extract<FileEvent, { kind: 'fileSaved' }>;
    return { revision: event.revision, byteLength: event.byteLength };
  }

  private abandon(requestId: string): void {
    this.abandoned.add(requestId);
    if (this.abandoned.size > ABANDONED_LIMIT) {
      const oldest = this.abandoned.values().next();
      if (!oldest.done) this.abandoned.delete(oldest.value);
    }
  }

  private request(
    expected: FileEvent['kind'],
    write: boolean,
    build: (requestId: string) => MobileCommand,
  ): Promise<FileEvent> {
    const requestId = this.options.requestId();
    return new Promise<FileEvent>((resolve, reject) => {
      const timer = this.schedule(() => {
        if (!this.pending.delete(requestId)) return;
        this.abandon(requestId);
        reject(write
          ? new WorkspaceFileError('file_write_unconfirmed', 'ambiguous', t('电脑长时间没有回复，结果无法确认，请刷新后查看。'))
          : new WorkspaceFileError('file_timeout', 'retryable', t('电脑长时间没有回复，请重试。')));
      }, write ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
      this.pending.set(requestId, { expected, write, resolve, reject, timer });
      this.options.send(build(requestId)).catch((error: unknown) => {
        if (!this.pending.delete(requestId)) return;
        this.cancelSchedule(timer);
        if (error instanceof WorkspaceFilesUnsupportedError) {
          reject(new WorkspaceFileError(
            'workspace_files_unavailable',
            'permanent',
            fileErrorMessage('workspace_files_unavailable', 'permanent'),
          ));
          return;
        }
        // 发送本身失败（未连接）意味着桌面没收到：读写都可安全重试。
        reject(new WorkspaceFileError(
          'file_send_failed',
          'retryable',
          error instanceof Error && error.message.includes('not connected') ? t('尚未连接到电脑。') : t('没能发给电脑，请重试。'),
        ));
      });
    });
  }
}

/** 与桌面 `mobileFileFailureFor` 的 code 一一对应；认不出的 code 只按类别给通用说明。 */
const FILE_ERROR_COPY: Readonly<Record<string, string>> = {
  workspace_not_trusted: '这个项目在电脑上还未被信任，文件只能查看。',
  workspace_not_open: '这个项目在电脑上未打开。在电脑上打开它，或在这里新建一个会话后再看文件。',
  workspace_file_not_found: '文件已不存在，请刷新。',
  workspace_file_permission_denied: '电脑上没有权限访问这个文件。',
  workspace_file_escapes_root: '这个条目指向项目外，不能操作。',
  workspace_file_exists: '同名条目已存在。',
  workspace_file_invalid_name: '名称不合法。',
  workspace_file_not_directory: '目标不是文件夹。',
  workspace_file_paste_into_self: '不能粘贴到自身内部。',
  workspace_file_root_protected: '项目根目录不能这样操作。',
  workspace_file_conflict: '电脑上的文件已变化，请重新载入后再保存。',
  workspace_file_not_regular: '这不是普通文件。',
  workspace_file_too_large: '文件超过上限。',
  workspace_file_not_text: '这个文件不是文本，不能编辑。',
  workspace_files_unavailable: '这台电脑上的 Connect 版本不支持文件。',
  file_download_expired: '文件传输已失效，请重新打开文件。',
  file_write_throttled: '操作太频繁，请稍后再试。',
  file_request_pending: '上一个操作还在进行。',
  file_write_unconfirmed: '电脑上的结果无法确认，请刷新后查看。',
  mobile_bridge_rejected: '这台手机没有写权限，请在电脑上授予。',
  workspace_capability_expired: '项目列表已更新，请刷新。',
  workspace_authorization_expired: '工作区授权已失效，请在电脑上重新授权后刷新。',
  audit_unavailable: '电脑上的安全审计暂时不可用，操作已拒绝。',
};

export function fileErrorMessage(code: string, category: WorkspaceFileErrorCategory): string {
  const copy = FILE_ERROR_COPY[code];
  if (copy !== undefined) return t(copy);
  return category === 'ambiguous' ? t('结果无法确认，请刷新后查看。') : t('操作没有完成，请重试。');
}

/** 文本内容解码；桌面已验证 UTF-8 且 sha256 已核对。 */
export function decodeWorkspaceText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
