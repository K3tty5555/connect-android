import type { LanguagePreference } from './types.js';

type ResolvedLanguage = Exclude<LanguagePreference, 'system'>;

/**
 * 繁中地区（STORE-STOREFRONT-SCOPE-01：iOS 首发上港澳台）。
 * 新加坡/马来西亚的华文使用简体，不在此列。
 */
const TRADITIONAL_REGIONS = new Set(['tw', 'hk', 'mo']);

/** 按 BCP-47 subtag 解析，而不是子串匹配——`ro-MO` / `en-HK` 不是中文。 */
function subtags(locale: string): string[] {
  return locale.toLowerCase().split(/[-_]/u).filter((part) => part !== '');
}

/**
 * 判定单条 locale 的中文字形；不是中文时返回 null。
 * 显式 script subtag 优先于 region，`zh-Hans-HK` 是简体。
 */
export function resolveChineseScript(locale: string): 'zh-Hans' | 'zh-Hant' | null {
  const [language, ...rest] = subtags(locale);
  if (language !== 'zh') return null;
  if (rest.includes('hant')) return 'zh-Hant';
  if (rest.includes('hans')) return 'zh-Hans';
  return rest.some((part) => TRADITIONAL_REGIONS.has(part)) ? 'zh-Hant' : 'zh-Hans';
}

/**
 * `Intl.NumberFormat` / `Intl.DateTimeFormat` 用的 locale 标签。
 *
 * zh-Hant 取 `zh-HK` 与界面用词口径一致（用户 2026-09-17 选香港用词）。
 * 这会同时决定日期次序：`zh-HK` 为 17/9/2026，`zh-TW` 为 2026/9/17。
 * 若日后改用台湾用词，这里要一起改。
 */
export const INTL_LOCALES: Record<ResolvedLanguage, string> = {
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-HK',
  en: 'en-US',
};

/**
 * 从系统 locale 列表解析界面语言。第一条中文条目决定繁简——用户把中文排在
 * `en-US` 之后仍应得到中文，但由那一条中文自己决定字形。
 */
export function resolveLanguageFromLocales(locales: readonly string[]): ResolvedLanguage {
  for (const locale of locales) {
    const script = resolveChineseScript(locale);
    if (script !== null) return script;
  }
  return 'en';
}
