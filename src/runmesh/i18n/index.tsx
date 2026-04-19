import React, { createContext, useContext, useState } from 'react';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';
import type { Language, Translations, TranslationKey, LanguageContextType } from './types';

const LANGUAGE_STORAGE_KEY = 'app-language';

const translations: Record<Language, Translations> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const interpolate = (text: string, params?: Record<string, string | number>) => {
  if (!params) return text;
  return Object.keys(params).reduce((acc, key) => {
    const value = String(params[key]);
    return acc.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }, text);
};

const normalizeLanguage = (lang?: string): Language => {
  if (!lang) return 'en-US';
  const lower = lang.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('en')) return 'en-US';
  return 'en-US';
};

const readStoredLanguage = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
};

export const getCurrentLanguage = (): Language => {
  const stored = readStoredLanguage();
  if (stored) {
    return normalizeLanguage(stored);
  }
  if (typeof navigator !== 'undefined') {
    const preferred = navigator.languages?.[0] || navigator.language;
    return normalizeLanguage(preferred);
  }
  return 'en-US';
};

export const translate = (key: TranslationKey, params?: Record<string, string | number>) => {
  const lang = getCurrentLanguage();
  const text = translations[lang][key] || key;
  return interpolate(text, params);
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => getCurrentLanguage());

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
      } catch {
        // ignore storage errors
      }
    }
  };

  const t = (key: TranslationKey, params?: Record<string, string | number>) => {
    const text = translations[language][key] || key;
    return interpolate(text, params);
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
