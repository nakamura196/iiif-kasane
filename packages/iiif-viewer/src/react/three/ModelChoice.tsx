'use client';

import { startTransition } from 'react';
import { useAtom } from 'jotai';
import { useContentLocale } from '../env';
import { modelChoicesAtom, paintedModelsAtom } from '../atoms';
import { labelIn } from '../../core';

// Buttons to switch each Choice of models (e.g. the ground: map / streets).
// Shown only when the manifest paints a Choice with two or more Models.
export default function ModelChoice({ className = '' }: { className?: string }) {
  const [models] = useAtom(paintedModelsAtom);
  const [choices, setChoices] = useAtom(modelChoicesAtom);
  const locale = useContentLocale();
  const choiceModels = models.filter((m) => m.options.length > 1);
  if (choiceModels.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {choiceModels.map((model) => {
        const current = choices[model.id] ?? 0;
        const groupLabel = labelIn(model.label, locale);
        return (
          <div
            key={model.id}
            role="radiogroup"
            aria-label={groupLabel || undefined}
            className="bg-[var(--ds-surface)] rounded-lg shadow-md border border-[var(--ds-border)] p-1.5 max-w-[min(20rem,calc(100vw-2rem))]"
          >
            {groupLabel && <div className="px-1.5 pb-1 text-xs text-[var(--ds-fg-muted,var(--ds-fg))]">{groupLabel}</div>}
            <div className="flex flex-col gap-1">
              {model.options.map((option, i) => {
                const selected = i === current;
                return (
                  <button
                    key={option.url}
                    role="radio"
                    aria-checked={selected}
                    // keep the shown model until the next one has loaded
                    onClick={() => startTransition(() => setChoices((c) => ({ ...c, [model.id]: i })))}
                    className={`text-left text-sm px-2 py-1 rounded transition-colors ${
                      selected
                        ? 'bg-blue-600 text-white'
                        : 'text-[var(--ds-fg)] hover:bg-[var(--ds-surface-2)]'
                    }`}
                  >
                    {labelIn(option.label, locale) || option.url.split('/').pop()}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
