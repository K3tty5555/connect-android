/**
 * `browserList` 的来源协商（ADR-003 §20.3）。
 *
 * 已发布手机（iOS/Android 1.0.16 及更早）解析 `browserList` 时，对每一项硬性要求
 * `source === 'connect-panel'`，并且整份列表用 `.every()` 判定：桌面只要投放一条
 * `ai-browser`，那些用户**连原本能用的内置面板也一起看不见**，而不是忽略新条目。
 *
 * 所以来源不能由桌面单方面决定，必须手机在请求里显式声明自己认得哪些。
 * 不声明（旧手机）就只给 `connect-panel`，回复与今天逐字节一致。
 *
 * 纯逻辑，桌面与手机共用。
 */

export const BROWSER_PANEL_SOURCES = ['connect-panel', 'ai-browser'] as const;
export type BrowserPanelSource = (typeof BROWSER_PANEL_SOURCES)[number];

/** 永远在列：手机至少要能看到自己在电脑上打开的那块网页面板。 */
const ALWAYS: BrowserPanelSource = 'connect-panel';

function isSource(value: unknown): value is BrowserPanelSource {
  return typeof value === 'string' && (BROWSER_PANEL_SOURCES as readonly string[]).includes(value);
}

/**
 * 这次请求该投放哪些来源。任何不认识的形状一律退回最保守的结果（只给内置面板），
 * 不抛错——协商失败的代价应该是"少看见"，不是"连不上"。
 */
export function requestedBrowserSources(
  command: { sources?: readonly string[] } | undefined,
): BrowserPanelSource[] {
  const requested = command?.sources;
  if (!Array.isArray(requested)) return [ALWAYS];
  const extra = BROWSER_PANEL_SOURCES.filter(
    (source) => source !== ALWAYS && requested.some((value) => isSource(value) && value === source),
  );
  return [ALWAYS, ...extra];
}
