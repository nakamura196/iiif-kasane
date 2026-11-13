'use client';

// The one row of filter buttons that every annotation list uses: the 3D list (creators, tags, kinds), the 2D
// annotations tab (kinds, units, tags) and the pages grid (kinds, classes). An "All" button comes first and is
// pressed while nothing is chosen; pressing a value shows only the annotations with one of the chosen values.
// The rules (what is shown under the limit, what a press does) are plain functions so they can be tested alone.

import { useState } from 'react';
import { clearPresentChoices, nextChoice } from '../../core';
import { useTranslations } from '../env';

export interface FilterOption {
  value: string;
  /** What the button says (the value itself when absent). */
  label?: string;
  /** How many items have the value. */
  count?: number;
  /** A colored square before the label (the class color of inference results). */
  color?: string;
}

/** The options shown: all of them, or the first `limit` and the chosen ones (a chosen value never hides). */
export const visibleOptions = <T extends FilterOption>(
  options: readonly T[],
  chosen: readonly string[],
  limit: number | undefined,
  expanded: boolean,
): T[] =>
  expanded || limit === undefined || options.length <= limit
    ? [...options]
    : options.filter((o, i) => i < limit || chosen.includes(o.value));

export interface FilterChipsProps {
  /** The name of the row (also its accessible name). */
  label: string;
  options: readonly FilterOption[];
  /** The chosen values; empty means all. Values the options do not have are ignored here, and kept by a press. */
  chosen: readonly string[];
  onChange: (next: string[]) => void;
  /** Several values at once (default), or one. */
  multiple?: boolean;
  /** Show this many options until "Show all" is pressed. */
  limit?: number;
  /** The row is shown only with at least this many options (default 1). */
  minOptions?: number;
}

export function FilterChips({ label, options, chosen, onChange, multiple = true, limit, minOptions = 1 }: FilterChipsProps) {
  const t = useTranslations('AnnotationFilter');
  const [expanded, setExpanded] = useState(false);
  if (options.length < minOptions) return null;
  const present = chosen.filter((v) => options.some((o) => o.value === v));
  const shown = visibleOptions(options, present, limit, expanded);
  const chip = (pressed: boolean) =>
    `inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${
      pressed
        ? 'border-blue-600 bg-blue-600 text-white'
        : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
    }`;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" role="group" aria-label={label} data-filter-chips={label}>
      <span className="text-gray-500 dark:text-gray-300 mr-1">{label}</span>
      <button type="button" aria-pressed={present.length === 0} onClick={() => onChange(clearPresentChoices(chosen, present))} className={chip(present.length === 0)}>
        {t('all')}
      </button>
      {shown.map((o) => {
        const pressed = present.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={pressed}
            data-value={o.value}
            onClick={() => onChange(nextChoice(chosen, o.value, multiple))}
            className={chip(pressed)}
          >
            {o.color ? (
              <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: o.color }} />
            ) : null}
            {o.label ?? o.value}
            {o.count !== undefined ? <span className="tabular-nums opacity-70">{o.count}</span> : null}
          </button>
        );
      })}
      {limit !== undefined && options.length > limit ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="px-1 text-blue-600 dark:text-blue-400 hover:underline"
        >
          {expanded ? t('fewer') : t('showAll', { count: options.length })}
        </button>
      ) : null}
    </div>
  );
}
