import type { MobileFileEntry, MobileFileMutation } from '../../../../src/shared/types';
import {
  joinMobileSubPath,
  parentMobileSubPath,
} from '../../../../src/shared/mobileFileBoundary';
import { t } from '../i18n';
import {
  WorkspaceFileError,
  type WorkspaceFileTransport,
} from '../domain/workspaceFiles';

/**
 * 手机文件树的状态（与 Mac `FileTree.tsx` 同语义）：懒加载、按目录定向刷新、
 * 剪贴状态按项目保存在内存（剪切粘贴后清空，重命名/删除被剪条目时清空）。
 * 不依赖 React，iPhone 项目页与 iPad 侧栏共用；界面经 subscribe 订阅。
 */

export type FileClip = { subPath: string; mode: 'copy' | 'cut' };

/** 按项目保存的剪贴状态：组件重挂（切页、横竖屏重排）不丢。 */
const clipboards = new Map<string, FileClip>();

export function workspaceFileClip(workspaceCapability: string): FileClip | null {
  return clipboards.get(workspaceCapability) ?? null;
}

/** capability 每次重连都会轮换：目录里已不存在的项目，剪贴状态随之丢弃。 */
export function pruneWorkspaceFileClips(liveCapabilities: ReadonlySet<string>): void {
  for (const capability of [...clipboards.keys()]) {
    if (!liveCapabilities.has(capability)) clipboards.delete(capability);
  }
}

interface Listing {
  status: 'loading' | 'ready' | 'error';
  entries: MobileFileEntry[];
  truncated: boolean;
  error: string | null;
}

export type FileTreeRow =
  | {
      type: 'entry';
      key: string;
      subPath: string;
      name: string;
      dir: boolean;
      hidden: boolean;
      depth: number;
      expanded: boolean;
      cut: boolean;
    }
  | {
      type: 'status';
      key: string;
      dirSubPath: string;
      depth: number;
      status: 'loading' | 'error' | 'empty' | 'truncated';
      message: string | null;
    };

export interface FileTreeSnapshot {
  rows: FileTreeRow[];
  rootStatus: Listing['status'] | 'idle';
  rootError: string | null;
  clip: FileClip | null;
  version: number;
}

export class WorkspaceFileTreeStore {
  private readonly listings = new Map<string, Listing>();
  private readonly expanded = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly loadGenerations = new Map<string, number>();
  private version = 0;
  private snapshot: FileTreeSnapshot;

  constructor(
    readonly workspaceCapability: string,
    private readonly transport: WorkspaceFileTransport,
  ) {
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FileTreeSnapshot => this.snapshot;

  /** 首次进入或重新获得连接时载入根目录；已载入则什么也不做。 */
  ensureRoot(): void {
    if (!this.listings.has('')) void this.load('');
  }

  async refreshAll(): Promise<void> {
    await Promise.all(['', ...this.expanded].map((subPath) => this.load(subPath)));
  }

  toggle(subPath: string): void {
    if (this.expanded.has(subPath)) {
      this.expanded.delete(subPath);
      this.publish();
      return;
    }
    this.expanded.add(subPath);
    this.publish();
    const listing = this.listings.get(subPath);
    if (listing === undefined || listing.status === 'error') void this.load(subPath);
  }

  setClip(clip: FileClip | null): void {
    if (clip === null) clipboards.delete(this.workspaceCapability);
    else clipboards.set(this.workspaceCapability, clip);
    this.publish();
  }

  async createFile(dirSubPath: string, name: string): Promise<string> {
    return this.runMutation({ op: 'createFile', dirSubPath, name }, [dirSubPath], dirSubPath);
  }

  async createDir(dirSubPath: string, name: string): Promise<string> {
    return this.runMutation({ op: 'createDir', dirSubPath, name }, [dirSubPath], dirSubPath);
  }

  async rename(subPath: string, name: string): Promise<string> {
    const parent = parentMobileSubPath(subPath);
    const result = await this.runMutation({ op: 'rename', subPath, name }, [parent]);
    this.forgetSubtree(subPath);
    this.clearClipUnder(subPath);
    this.publish();
    return result;
  }

  async remove(subPath: string): Promise<void> {
    const parent = parentMobileSubPath(subPath);
    await this.runMutation({ op: 'delete', subPath }, [parent]);
    this.forgetSubtree(subPath);
    this.clearClipUnder(subPath);
    this.publish();
  }

  async paste(targetDirSubPath: string): Promise<string> {
    const clip = workspaceFileClip(this.workspaceCapability);
    if (clip === null) throw new WorkspaceFileError('file_clip_empty', 'action_required', t('没有可粘贴的条目。'));
    const affected = clip.mode === 'cut'
      ? [targetDirSubPath, parentMobileSubPath(clip.subPath)]
      : [targetDirSubPath];
    const name = await this.runMutation(
      { op: 'paste', sourceSubPath: clip.subPath, mode: clip.mode, targetDirSubPath },
      affected,
      targetDirSubPath,
    );
    if (clip.mode === 'cut') {
      this.forgetSubtree(clip.subPath);
      this.setClip(null);
    }
    return name;
  }

  private async runMutation(
    mutation: MobileFileMutation,
    refresh: readonly string[],
    expandDir?: string,
  ): Promise<string> {
    try {
      const result = await this.transport.mutate(this.workspaceCapability, mutation);
      if (expandDir !== undefined && expandDir !== '') this.expanded.add(expandDir);
      return result.name ?? '';
    } finally {
      // 成功与失败都刷新：ambiguous 时目录可能已变化，刷新是用户唯一可信的结果来源。
      await Promise.all([...new Set(refresh)].map((subPath) => this.load(subPath)));
    }
  }

  private async load(subPath: string): Promise<void> {
    const generation = (this.loadGenerations.get(subPath) ?? 0) + 1;
    this.loadGenerations.set(subPath, generation);
    const previous = this.listings.get(subPath);
    this.listings.set(subPath, {
      status: previous?.status === 'ready' ? 'ready' : 'loading',
      entries: previous?.entries ?? [],
      truncated: previous?.truncated ?? false,
      error: null,
    });
    if (previous?.status !== 'ready') this.publish();
    try {
      const listing = await this.transport.list(this.workspaceCapability, subPath);
      if (this.loadGenerations.get(subPath) !== generation) return;
      this.listings.set(subPath, { status: 'ready', ...listing, error: null });
    } catch (error) {
      if (this.loadGenerations.get(subPath) !== generation) return;
      this.listings.set(subPath, {
        status: 'error',
        entries: [],
        truncated: false,
        error: error instanceof Error ? error.message : t('无法读取目录'),
      });
    }
    this.publish();
  }

  private forgetSubtree(subPath: string): void {
    // 在途的列目录必须一并作废，否则慢回复会把已删除/改名的目录以 ready 状态写回。
    for (const key of [...this.loadGenerations.keys()]) {
      if (key === subPath || key.startsWith(`${subPath}/`)) {
        this.loadGenerations.set(key, (this.loadGenerations.get(key) ?? 0) + 1);
      }
    }
    for (const key of [...this.listings.keys()]) {
      if (key === subPath || key.startsWith(`${subPath}/`)) this.listings.delete(key);
    }
    for (const key of [...this.expanded]) {
      if (key === subPath || key.startsWith(`${subPath}/`)) this.expanded.delete(key);
    }
  }

  private clearClipUnder(subPath: string): void {
    const clip = workspaceFileClip(this.workspaceCapability);
    if (clip !== null && (clip.subPath === subPath || clip.subPath.startsWith(`${subPath}/`))) {
      this.setClip(null);
    }
  }

  private publish(): void {
    this.version += 1;
    this.snapshot = this.buildSnapshot();
    for (const listener of [...this.listeners]) listener();
  }

  private buildSnapshot(): FileTreeSnapshot {
    const clip = workspaceFileClip(this.workspaceCapability);
    const rows: FileTreeRow[] = [];
    const visit = (dirSubPath: string, depth: number): void => {
      const listing = this.listings.get(dirSubPath);
      if (listing === undefined || listing.status === 'loading') {
        if (dirSubPath !== '') {
          rows.push({ type: 'status', key: `status:${dirSubPath}`, dirSubPath, depth, status: 'loading', message: null });
        }
        return;
      }
      if (listing.status === 'error') {
        if (dirSubPath !== '') {
          rows.push({
            type: 'status', key: `status:${dirSubPath}`, dirSubPath, depth, status: 'error', message: listing.error,
          });
        }
        return;
      }
      if (listing.entries.length === 0 && dirSubPath !== '') {
        rows.push({ type: 'status', key: `status:${dirSubPath}`, dirSubPath, depth, status: 'empty', message: null });
      }
      for (const entry of listing.entries) {
        const subPath = joinMobileSubPath(dirSubPath, entry.name);
        const expanded = entry.dir && this.expanded.has(subPath);
        rows.push({
          type: 'entry',
          key: `entry:${subPath}`,
          subPath,
          name: entry.name,
          dir: entry.dir,
          hidden: entry.hidden,
          depth,
          expanded,
          cut: clip?.mode === 'cut' && clip.subPath === subPath,
        });
        if (expanded) visit(subPath, depth + 1);
      }
      if (listing.truncated) {
        rows.push({ type: 'status', key: `truncated:${dirSubPath}`, dirSubPath, depth, status: 'truncated', message: null });
      }
    };
    visit('', 0);
    const root = this.listings.get('');
    return {
      rows,
      rootStatus: root?.status ?? 'idle',
      rootError: root?.status === 'error' ? root.error : null,
      clip,
      version: this.version,
    };
  }
}
