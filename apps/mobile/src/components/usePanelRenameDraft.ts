import { useState } from 'react';
import { t } from '../i18n';

/**
 * 就地给窗口改名的编辑状态（用户 2026-11-02）：手机切换列表与 iPad 标签条共用。
 * 只编辑当前窗口（activePanelId 一变，编辑自动作废，与「只改当前附着窗口」的协议边界一致）；
 * 提交中不接受取消；失败保留输入框与原因。
 */
export interface PanelRenameDraft {
  /** 正在编辑的状态；不是当前窗口的编辑一律视为没有。 */
  editing: { panelId: string; draft: string; busy: boolean; error: string | null } | null;
  start(panelId: string, currentLabel: string): void;
  change(draft: string): void;
  submit(): void;
  cancel(): void;
}

export function usePanelRenameDraft(
  activePanelId: string | null,
  onRename: ((panelId: string, title: string) => Promise<void>) | undefined,
): PanelRenameDraft {
  const [state, setState] = useState<PanelRenameDraft['editing']>(null);
  const editing = state !== null && state.panelId === activePanelId && onRename !== undefined ? state : null;
  return {
    editing,
    start: (panelId, currentLabel) => {
      if (onRename === undefined || panelId !== activePanelId) return;
      setState({ panelId, draft: currentLabel, busy: false, error: null });
    },
    change: (draft) => {
      if (editing === null || editing.busy) return;
      setState({ ...editing, draft, error: null });
    },
    submit: () => {
      if (editing === null || editing.busy || onRename === undefined) return;
      const { panelId, draft } = editing;
      setState({ ...editing, busy: true, error: null });
      onRename(panelId, draft).then(
        () => setState((current) => (current?.panelId === panelId ? null : current)),
        (error: unknown) => setState((current) => (current?.panelId === panelId
          ? { ...current, busy: false, error: error instanceof Error && error.message ? error.message : t('改名失败，请重试。') }
          : current)),
      );
    },
    cancel: () => {
      if (editing?.busy === true) return;
      setState(null);
    },
  };
}
