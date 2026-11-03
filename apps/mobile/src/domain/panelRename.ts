import { t } from '../i18n';
import type { MobileCommand, MobileEvent } from '../net/bridgeClient';

/**
 * 手机给窗口改名（用户 2026-11-02）：电脑上与标签改名同一条路径，手机这边只负责
 * 发请求、按 requestId 等回执、把失败说清楚。改名可重复执行，失败一律可重试。
 */
const TIMEOUT_MS = 8_000;

export class PanelRenameError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export interface PanelRenameTransportOptions {
  send(command: MobileCommand): Promise<void>;
  requestId(): string;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (timer: ReturnType<typeof setTimeout>) => void;
}

interface Pending {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function renameErrorMessage(code: string): string {
  switch (code) {
    case 'panel_rename_throttled': return t('改名太频繁，请稍后再试。');
    case 'not_attached': return t('窗口已切换，请重新打开后再改名。');
    case 'mobile_bridge_rejected': return t('这台手机只有查看权限，写操作需在电脑上授予。');
    default: return t('改名失败，请重试。');
  }
}

export class PanelRenameTransport {
  private readonly pending = new Map<string, Pending>();
  private readonly schedule: NonNullable<PanelRenameTransportOptions['schedule']>;
  private readonly cancelSchedule: NonNullable<PanelRenameTransportOptions['cancelSchedule']>;

  constructor(private readonly options: PanelRenameTransportOptions) {
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelSchedule = options.cancelSchedule ?? ((timer) => clearTimeout(timer));
  }

  /** 空白名字等于恢复自动名称（与电脑标签清空同口径）。 */
  rename(panelId: string, title: string): Promise<void> {
    const requestId = this.options.requestId();
    const trimmed = title.trim();
    return new Promise<void>((resolve, reject) => {
      const timer = this.schedule(() => {
        if (!this.pending.delete(requestId)) return;
        reject(new PanelRenameError('panel_rename_timeout', t('电脑长时间没有回复，请重试。')));
      }, TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.options.send({ kind: 'renamePanel', requestId, panelId, title: trimmed.length > 0 ? trimmed : null })
        .catch(() => {
          if (!this.pending.delete(requestId)) return;
          this.cancelSchedule(timer);
          reject(new PanelRenameError('panel_rename_send_failed', t('没能发给电脑，请重试。')));
        });
    });
  }

  /** 是本模块的回执就消费掉并返回 true。 */
  handle(event: MobileEvent): boolean {
    if (event.kind !== 'panelRenameAccepted' && event.kind !== 'error') return false;
    if (event.requestId === undefined) return false;
    const pending = this.pending.get(event.requestId);
    if (pending === undefined) return false;
    this.pending.delete(event.requestId);
    this.cancelSchedule(pending.timer);
    if (event.kind === 'error') pending.reject(new PanelRenameError(event.code, renameErrorMessage(event.code)));
    else pending.resolve();
    return true;
  }

  cancelForDisconnect(): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      this.cancelSchedule(pending.timer);
      pending.reject(new PanelRenameError('panel_rename_disconnected', t('连接中断，恢复后请重试。')));
    }
  }
}
