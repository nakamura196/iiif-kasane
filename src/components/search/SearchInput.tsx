'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { buttonClass } from '@nakamura196/react-ui';
import { DISCOVERY_MAX_ITEMS } from '@nakamura196/iiif-viewer/core';
import { SEARCH_EXAMPLES } from './examples';

/** URL を入れる最初の画面。onOpen で読み込む URL を親に渡す。 */
export default function SearchInput({ onOpen }: { onOpen: (url: string) => void }) {
  const t = useTranslations('Search');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const go = (u: string) => onOpen(u);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      new URL(url.trim());
      go(url.trim());
    } catch {
      setError(t('invalidUrl'));
    }
  };
  return (
    <div className="max-w-xl w-full mx-auto px-4 py-12">
      <h2 className="text-2xl font-bold text-[var(--ds-fg)] mb-2" style={{ fontFamily: 'var(--ds-font-serif)' }}>
        {t('title')}
      </h2>
      <p className="text-sm text-[var(--ds-fg-muted)] mb-6">{t('lead', { max: DISCOVERY_MAX_ITEMS })}</p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.org/collection.json"
          aria-label={t('inputLabel')}
          className="w-full px-4 py-2 rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] placeholder-[var(--ds-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-ring)]"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" className={buttonClass('primary', 'md', 'w-full')}>
          {t('submit')}
        </button>
      </form>
      <div className="mt-6 text-sm text-[var(--ds-fg-muted)]">
        <h3 className="font-medium mb-2">{t('examplesHeading')}:</h3>
        <ul className="space-y-2">
          {SEARCH_EXAMPLES.map((ex) => (
            <li key={ex.key}>
              <button onClick={() => go(ex.url)} className="text-left text-[var(--ds-primary)] hover:underline">
                {t(`examples.${ex.key}`, { max: DISCOVERY_MAX_ITEMS })}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-6">{t('privacy')}</p>
      </div>
    </div>
  );
}
