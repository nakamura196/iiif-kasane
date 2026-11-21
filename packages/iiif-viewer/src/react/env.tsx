'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import { contentLocale } from '../core/services/contentLanguage';
import { contentLanguageAtom } from './internalState';
import { messages as bundled, type ViewerMessages } from './messages';

export type ViewerLocale = 'ja' | 'en';
export type ResolvedTheme = 'light' | 'dark';

interface Env {
  locale: string;
  messages: ViewerMessages;
  resolvedTheme: ResolvedTheme;
  /** Lighting of the 3D view; see SceneEnvironmentOption. Undefined means the built-in one. */
  environment?: string;
}

// Without a provider the viewer still works: Japanese, light.
const DEFAULT_ENV: Env = { locale: 'ja', messages: bundled.ja, resolvedTheme: 'light' };

const EnvContext = createContext<Env>(DEFAULT_ENV);

export function ViewerEnv({
  locale = 'ja',
  messages,
  resolvedTheme = 'light',
  environment,
  children,
}: {
  locale?: string;
  /** Defaults to the messages bundled with the package for `locale`. */
  messages?: ViewerMessages;
  resolvedTheme?: ResolvedTheme;
  /**
   * Lighting of the 3D view: "built-in" (default, no network request), "none", a drei preset
   * name (fetched from raw.githack.com), or the URL of an .hdr / .exr file.
   */
  environment?: string;
  children: ReactNode;
}) {
  const value = useMemo<Env>(
    () => ({
      locale,
      messages: messages ?? (locale === 'en' ? bundled.en : bundled.ja),
      resolvedTheme,
      environment,
    }),
    [locale, messages, resolvedTheme, environment],
  );
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

/** Replace `{name}` placeholders. Unknown names are left as they are. */
export function format(template: string, values?: Record<string, string | number>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

export type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Same call shape as next-intl: `const t = useTranslations('Info'); t('metadata')`. */
export function useTranslations(namespace: string): Translator {
  const { messages } = useContext(EnvContext);
  return useCallback(
    (key, values) => {
      const text = messages[namespace]?.[key];
      return text === undefined ? `${namespace}.${key}` : format(text, values);
    },
    [messages, namespace],
  );
}

export function useLocale(): string {
  return useContext(EnvContext).locale;
}

/**
 * The locale string for reading a resource's own text (labels, metadata, annotation bodies): the language the
 * reader chose for the content, then the UI locale. Without a choice it is the UI locale itself. Use `useLocale()`
 * for the UI (dates, the viewer's own messages).
 */
export function useContentLocale(): string {
  const locale = useLocale();
  const chosen = useAtomValue(contentLanguageAtom);
  return contentLocale(locale, chosen);
}

/** Same shape as next-themes' useTheme, reduced to what the viewer reads. */
export function useTheme(): { resolvedTheme: ResolvedTheme } {
  return { resolvedTheme: useContext(EnvContext).resolvedTheme };
}

/** The 3D lighting chosen for this viewer (undefined: the built-in one). */
export function useSceneEnvironment(): string | undefined {
  return useContext(EnvContext).environment;
}
