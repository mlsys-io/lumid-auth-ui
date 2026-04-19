import zhCN from './locales/zh-CN';

export type Language = 'zh-CN' | 'en-US';

export type Translations = typeof zhCN;

export type TranslationKey = keyof Translations;

export interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}
