'use client';

import type { ReactNode } from 'react';
import { useAtom } from 'jotai';
import { defaultChoiceIndex, labelIn, type MediaOption, type PaintingContent } from '../../core';
import { modelChoicesAtom, type ChoiceCompareMode } from '../atoms';
import { useLocale, useTranslations } from '../env';

const optionLabel = (o: MediaOption, locale: string) =>
  labelIn(o.label, locale) || decodeURIComponent(o.url.split('/').pop() ?? o.url);

// Audio / video: the first option this browser can play. Others: the first option.
const initialIndex = (painting: PaintingContent): number => {
  if (typeof document === 'undefined') return 0;
  const probe = document.createElement('video');
  return defaultChoiceIndex(painting.options, (f) => probe.canPlayType(f));
};

const chosenIndex = (painting: PaintingContent, choices: Record<string, number>): number =>
  Math.min(choices[painting.id] ?? initialIndex(painting), painting.options.length - 1);

/** Index of the chosen option of a painting (a Choice opens on its first playable one by default). */
export function useChoiceIndex(painting: PaintingContent | undefined): number {
  const [choices] = useAtom(modelChoicesAtom);
  return painting ? chosenIndex(painting, choices) : 0;
}

/** Comparing two candidates of an image Choice in place: the mode, B's candidate, and B's opacity in overlay. */
export interface ChoiceCompareControls {
  mode: ChoiceCompareMode;
  onModeChange: (mode: ChoiceCompareMode) => void;
  b: number;
  onBChange: (index: number) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
}

/** B's candidate: the one kept for this Choice when it is another than A, else the one after A. */
export const compareBIndex = (stored: number | undefined, a: number, count: number): number =>
  stored !== undefined && stored >= 0 && stored < count && stored !== a ? stored : count > 1 ? (a + 1) % count : 0;

const COMPARE_MODES: ChoiceCompareMode[] = ['single', 'swipe', 'spyglass', 'overlay', 'side'];

const selectClass =
  'text-sm rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-fg)] px-1 py-0.5 max-w-full';

// A Choice between two or more candidates of an image / video / audio painting.
// `index` / `onChange` given: the caller keeps the choice (an image Canvas keeps it as layer visibility).
// `compare` given (an image Choice): a menu to compare two candidates in place (swipe, spyglass, overlay, side by side).
// `children` (e.g. a link to the comparison page) go at the right end of the bar.
export default function ChoiceBar({
  painting,
  index: controlled,
  onChange,
  compare,
  children,
}: {
  painting: PaintingContent;
  index?: number;
  onChange?: (index: number) => void;
  compare?: ChoiceCompareControls;
  children?: ReactNode;
}) {
  const t = useTranslations('Viewer');
  const locale = useLocale();
  const [choices, setChoices] = useAtom(modelChoicesAtom);
  const index = controlled ?? chosenIndex(painting, choices);
  if (painting.options.length < 2) return null;

  const comparing = !!compare && compare.mode !== 'single';
  const options = painting.options.map((o, i) => (
    <option key={o.url} value={i}>
      {optionLabel(o, locale)}
    </option>
  ));

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 p-1.5 bg-[var(--ds-surface)] border-b border-[var(--ds-border)]">
      <label className="text-sm text-[var(--ds-fg)]" htmlFor="iiif-viewer-choice">
        {comparing ? `${t('choice')} ${t('choiceCompareA')}` : t('choice')}
      </label>
      <select
        id="iiif-viewer-choice"
        value={index}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (onChange) onChange(next);
          else setChoices((c) => ({ ...c, [painting.id]: next }));
        }}
        className={selectClass}
      >
        {options}
      </select>
      {compare && (
        <>
          <label className="text-sm text-[var(--ds-fg)] sm:ml-2" htmlFor="iiif-viewer-choice-compare">
            {t('choiceCompare')}
          </label>
          <select
            id="iiif-viewer-choice-compare"
            value={compare.mode}
            onChange={(e) => compare.onModeChange(e.target.value as ChoiceCompareMode)}
            className={selectClass}
          >
            {COMPARE_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`choiceCompare_${m}`)}
              </option>
            ))}
          </select>
          {comparing && (
            <>
              <label className="text-sm text-[var(--ds-fg)]" htmlFor="iiif-viewer-choice-b">
                {t('choiceCompareB')}
              </label>
              <select
                id="iiif-viewer-choice-b"
                value={compare.b}
                onChange={(e) => compare.onBChange(Number(e.target.value))}
                className={selectClass}
              >
                {options}
              </select>
            </>
          )}
          {compare.mode === 'overlay' && (
            <label className="flex items-center gap-1 text-sm text-[var(--ds-fg)]">
              {t('choiceCompareOpacity')}
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(compare.opacity * 100)}
                onChange={(e) => compare.onOpacityChange(Number(e.target.value) / 100)}
                className="w-24"
              />
            </label>
          )}
        </>
      )}
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}
