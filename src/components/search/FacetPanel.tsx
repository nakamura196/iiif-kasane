'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FacetSelection, SearchFacet } from 'iiif-kasane/core';

const SHOWN = 8; // 値を最初に見せる数

/** 語句の欄と、項目ごとの値のチェックボックス。 */
export default function FacetPanel({
  facets,
  selection,
  query,
  onQuery,
  onToggle,
}: {
  facets: SearchFacet[];
  selection: FacetSelection;
  query: string;
  onQuery: (q: string) => void;
  onToggle: (key: string, value: string) => void;
}) {
  const t = useTranslations('Search');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('queryPlaceholder')}
        aria-label={t('queryPlaceholder')}
        className="w-full px-3 py-1.5 text-sm rounded-md border border-[var(--ds-border)] bg-[var(--ds-bg)] text-[var(--ds-fg)] placeholder-[var(--ds-fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-ring)]"
      />
      {facets.map((f) => {
        const open = expanded[f.key];
        const values = open ? f.values : f.values.slice(0, SHOWN);
        return (
          <section key={f.key}>
            <h3 className="text-xs font-semibold text-[var(--ds-fg-muted)] mb-1">{f.key}</h3>
            <ul className="space-y-0.5">
              {values.map(({ value, count }) => (
                <li key={value}>
                  <label className="flex items-center gap-2 text-sm text-[var(--ds-fg)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selection[f.key]?.includes(value) ?? false}
                      onChange={() => onToggle(f.key, value)}
                    />
                    <span className="flex-1 truncate" title={value}>
                      {value}
                    </span>
                    <span className="text-xs text-[var(--ds-fg-muted)] tabular-nums">{count}</span>
                  </label>
                </li>
              ))}
            </ul>
            {f.values.length > SHOWN && (
              <button
                onClick={() => setExpanded((o) => ({ ...o, [f.key]: !open }))}
                className="mt-1 text-xs text-[var(--ds-primary)] hover:underline"
              >
                {open ? t('less') : t('more', { count: f.values.length - SHOWN })}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
