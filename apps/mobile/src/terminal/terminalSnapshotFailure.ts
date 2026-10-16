export const TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE = '终端窗口过大，请在 Mac 缩小窗口后刷新。';

const TERMINAL_SNAPSHOT_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  terminal_snapshot_too_large: TERMINAL_SNAPSHOT_TOO_LARGE_MESSAGE,
  terminal_mirror_overflow: '终端输出过快，权威快照已失效，请新建终端或在 Mac 重新打开此终端。',
  terminal_mirror_unavailable: '终端权威快照不可用，请新建终端或在 Mac 重新打开此终端。',
};

export function terminalSnapshotFailureDetail(code: string): string | null {
  return TERMINAL_SNAPSHOT_FAILURE_MESSAGES[code] ?? null;
}
