'use client';

import { useTranslations } from 'next-intl';
import type { FacetSelection } from 'iiif-kasane/core';

/** 選んでいる値の一覧（押すと外れる）。 */
export default function ActiveFilters({
  selection,
  onToggle,
  onClear,
}: {
  selection: FacetSelection;
  onToggle: (key: string, value: string) => void;
  onClear: () => void;
}) {
  const t = useTranslations('Search');
  const active = Object.entries(selection).flatMap(([k, vs]) => vs.map((v) => [k, v] as const));
  if (active.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {active.map(([k, v]) => (
        <button
          key={`${k}:${v}`}
          onClick={() => onToggle(k, v)}
          className="text-xs rounded-full border border-[var(--ds-border)] px-2 py-0.5 text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]"
          aria-label={t('remove', { value: `${k}: ${v}` })}
        >
          {k}: {v} ×
        </button>
      ))}
      <button onClick={onClear} className="text-xs text-[var(--ds-primary)] hover:underline">
        {t('clear')}
      </button>
    </div>
  );
}
