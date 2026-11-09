'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { facetsOf, filterItems } from '@nakamura196/iiif-viewer/core';
import Header from '@/components/Header';
import ActiveFilters from '@/components/search/ActiveFilters';
import FacetPanel from '@/components/search/FacetPanel';
import ResultGrid from '@/components/search/ResultGrid';
import SearchInput from '@/components/search/SearchInput';
import { toggleValue, useSearchState, writeSearchParams } from '@/components/search/useSearchState';
import { useSearchSource } from '@/components/search/useSearchSource';

// キュレーションとコレクションを、メタデータで絞り込んで一覧にする画面。
// 状態は useSearchState（URL と対応）、読み込みは useSearchSource、絞り込みは core の facets が受け持つ。
// ここは並べるだけ。
export default function SearchContent() {
  const t = useTranslations('Search');
  const locale = useLocale();
  const { url, query, selection, ready, open, setQuery, setSelection } = useSearchState();
  const status = useSearchSource(url, locale);

  // 読み込みの途中でも、読めた分を一覧とファセットに出す
  const loading = status.kind === 'loading';
  const source = status.kind === 'ready' ? status.source : status.kind === 'loading' ? (status.partial ?? null) : null;
  const items = useMemo(() => source?.items ?? [], [source]);
  const hits = useMemo(() => filterItems(items, query, selection), [items, query, selection]);
  const facets = useMemo(() => facetsOf(items, query, selection), [items, query, selection]);
  const toggle = (key: string, value: string) => setSelection((s) => toggleValue(s, key, value));

  if (!ready) return null;
  if (!url) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header />
        <main className="flex-1 bg-[var(--ds-bg)]">
          <SearchInput onOpen={open} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <Header compact />
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden bg-[var(--ds-bg)]">
        <aside className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-[var(--ds-border)] overflow-y-auto max-h-[40vh] md:max-h-none p-3">
          <FacetPanel facets={facets} selection={selection} query={query} onQuery={setQuery} onToggle={toggle} />
        </aside>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-[var(--ds-fg)] break-all">{source?.label || url}</h2>
            {source && (
              <span className="text-sm text-[var(--ds-fg-muted)]">
                {t(`kinds.${source.kind}`)} · {t('count', { hits: hits.length, total: items.length })}
              </span>
            )}
            <button onClick={() => open(null)} className="text-sm text-[var(--ds-primary)] hover:underline">
              {t('change')}
            </button>
          </div>

          {status.kind === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{t('error')}</p>}
          {status.kind === 'loading' && (
            <p className="mb-3 text-sm text-[var(--ds-fg-muted)]" role="status">
              {status.progress
                ? t('loadingManifests', { done: status.progress[0], total: status.progress[1] })
                : t('loading')}
            </p>
          )}
          {source && source.failed > 0 && (
            <p className="mb-3 text-sm text-[var(--ds-fg-muted)]">{t('failed', { count: source.failed })}</p>
          )}

          <ActiveFilters selection={selection} onToggle={toggle} onClear={() => setSelection(() => ({}))} />

          {/* 絞り込みが変わったら作り直して、並べる件数を最初に戻す */}
          {source && <ResultGrid key={writeSearchParams({ url: null, query, selection }).toString()} items={hits} loading={loading} />}
        </div>
      </main>
    </div>
  );
}
