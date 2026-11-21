'use client';

import { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { languagesOf } from '../../core/services/contentLanguage';
import { useLocale, useTranslations } from '../env';
import { contentLanguageAtom, contentLanguageChangeAtom } from '../internalState';

const nameOf = (tag: string, uiLocale: string): string => {
  try {
    return new Intl.DisplayNames([uiLocale], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
};

/**
 * Chooses the language of the resource's own text (label, metadata, annotation bodies), apart from the UI
 * language. It draws nothing unless the resource has two or more languages ("none" does not count).
 */
export default function ContentLanguageSelect({ resource }: { resource: unknown }) {
  const t = useTranslations('ContentLanguage');
  const locale = useLocale();
  const [chosen, setChosen] = useAtom(contentLanguageAtom);
  const report = useAtomValue(contentLanguageChangeAtom);
  const languages = useMemo(() => languagesOf(resource), [resource]);
  if (languages.length < 2) return null;
  // a language given from outside that this resource lacks is still shown, so the select does not lie
  const options = chosen && !languages.includes(chosen) ? [...languages, chosen] : languages;
  return (
    <label className="shrink-0 flex items-center gap-1 px-2 text-xs text-gray-500 dark:text-gray-300">
      <span className="hidden sm:inline">{t('label')}</span>
      <select
        className="rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1 py-0.5 text-gray-700 dark:text-gray-200"
        aria-label={t('label')}
        value={chosen ?? ''}
        onChange={(e) => {
          const next = e.target.value || null;
          setChosen(next);
          report?.call(next ?? undefined);
        }}
      >
        <option value="">{t('auto')}</option>
        {options.map((l) => (
          <option key={l} value={l}>
            {nameOf(l, locale)} ({l})
          </option>
        ))}
      </select>
    </label>
  );
}
