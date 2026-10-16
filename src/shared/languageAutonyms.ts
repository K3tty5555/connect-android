import type { LanguagePreference } from './types.js';

type ExplicitLanguage = Exclude<LanguagePreference, 'system'>;

export const LANGUAGE_AUTONYMS = {
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
} as const satisfies Record<ExplicitLanguage, string>;
