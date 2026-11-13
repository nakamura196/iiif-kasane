'use client';

// In the pages grid: the controls that run a model over every page, and the marks drawn over the thumbnails of
// pages already read. The marks come from the inference tab's results (inferenceResultsAtom), so pages read one at a
// time in the inference tab get them too. The class buttons share the annotations tab's tag filter
// (canvasAnnotationTagsAtom): choosing a class here also narrows the marks on the image and the annotations list.
import { useEffect, useMemo, useState } from 'react';
import { atom, useAtom, useAtomValue, useStore } from 'jotai';
import { pageMarksOf, type ContainerInfo, type ManifestV4, type PageMark } from '../../core';
import { useLocale, useTranslations } from '../env';
import { batchStateAtom, batchTargetsOf, readingPageAtom, startBatch, stopBatch } from '../inference/batch';
import { modelStatus } from '../inference/modelStore';
import { MODELS } from '../inference/models/registry';
import type { InferenceModel } from '../inference/models/types';
import { inferenceResultsAtom, resultKey } from '../inference/state';
import { canvasAnnotationTagsAtom } from '../overlays/canvasAnnotationState';

const BUTTON =
  'px-2.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40';
const PRIMARY = 'px-2.5 py-1 rounded text-xs text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40';

/** The model whose results the thumbnails show (the one chosen in the pages grid). */
export const batchModelAtom = atom<string | null>(null);

// Do not rebuild the marks of the same result again (during a run the classes are counted after every page).
const marksCache = new WeakMap<object, PageMark[]>();
const marksOf = (page: Record<string, unknown> | undefined): PageMark[] => {
  if (!page) return [];
  let m = marksCache.get(page);
  if (!m) marksCache.set(page, (m = pageMarksOf(page)));
  return m;
};

/** The model the thumbnails show: the running one, else the chosen one. */
const shownModelAtom = atom((get) => {
  const b = get(batchStateAtom);
  return b?.running ? b.modelId : get(batchModelAtom);
});

/** The classes in the shown model's results, with how many marks each has (most first) and their color. */
const shownTagsAtom = atom((get) => {
  const modelId = get(shownModelAtom);
  const counts = new Map<string, { count: number; color: string }>();
  if (!modelId) return [];
  for (const r of Object.values(get(inferenceResultsAtom))) {
    if (r.modelId !== modelId) continue;
    for (const m of marksOf(r.page)) {
      if (!m.tag) continue;
      const e = counts.get(m.tag) ?? { count: 0, color: m.color };
      e.count++;
      counts.set(m.tag, e);
    }
  }
  return [...counts].map(([value, e]) => ({ value, ...e })).sort((a, b) => b.count - a.count);
});

/** The chosen tags that the shown results have (tags chosen for other annotations do not hide the marks). */
const shownChosenTagsAtom = atom((get) => {
  const tags = new Set(get(shownTagsAtom).map((g) => g.value));
  return get(canvasAnnotationTagsAtom).filter((v) => tags.has(v));
});

/** Models that read a whole image without clicks (the ones a run over every page can use). */
const BATCH_MODELS = MODELS.filter((m) => m.input !== 'points');

const useReadyModels = (): InferenceModel[] | null => {
  const [ready, setReady] = useState<InferenceModel[] | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(BATCH_MODELS.map(async (m) => ((await modelStatus(m)) === 'ready' ? m : null))).then(
      (ms) => live && setReady(ms.filter((m): m is InferenceModel => !!m)),
    );
    return () => {
      live = false;
    };
  }, []);
  return ready;
};

export function PagesBatchBar({ pages, manifest }: { pages: ContainerInfo[]; manifest: ManifestV4 | null | undefined }) {
  const t = useTranslations('Inference');
  const locale = useLocale() === 'ja' ? 'ja' : 'en';
  const store = useStore();
  const ready = useReadyModels();
  const [modelId, setModelId] = useAtom(batchModelAtom);
  const batch = useAtomValue(batchStateAtom);
  const results = useAtomValue(inferenceResultsAtom);
  const [chosenTags, setChosenTags] = useAtom(canvasAnnotationTagsAtom);
  const running = !!batch?.running;

  // Without a chosen model, take the first downloaded one
  useEffect(() => {
    if (ready && ready.length > 0 && !ready.some((m) => m.id === modelId)) setModelId(ready[0].id);
  }, [ready, modelId, setModelId]);
  const model = ready?.find((m) => m.id === modelId) ?? null;
  const shownModel = useAtomValue(shownModelAtom);

  const tags = useAtomValue(shownTagsAtom);
  const toggleTag = (v: string) => setChosenTags((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  if (ready === null) return null;
  if (ready.length === 0) {
    return <p className="px-2 pt-2 text-xs text-gray-500 dark:text-gray-400">{t('batchNoModel')}</p>;
  }

  const targets = batchTargetsOf(pages);
  // Only pages without a result are read (after a stop, the run goes on from there)
  const remaining = model ? targets.filter((c) => !results[resultKey(c.id, model.id)]).length : targets.length;
  const resuming = remaining < targets.length;
  const status = !batch || batch.modelId !== shownModel
    ? null
    : batch.running
      ? t('batchProgress', { done: batch.done, total: batch.total })
      : batch.total === 0
        ? t('batchNothing')
        : batch.stopped
          ? t('batchStopped', { done: batch.done, total: batch.total })
          : t('batchDone', { total: batch.total });

  return (
    <div className="px-2 pt-2 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1 min-w-0">
          <span className="text-gray-500 dark:text-gray-400">{t('batchModel')}</span>
          <select
            className="min-w-0 max-w-[12rem] rounded border border-gray-300 dark:border-gray-600 bg-transparent px-1 py-0.5"
            value={shownModel ?? ''}
            disabled={running}
            onChange={(e) => setModelId(e.target.value)}
          >
            {ready.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name[locale]}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className={BUTTON} onClick={() => stopBatch(store)}>
            {t('batchStop')}
          </button>
        ) : (
          <button
            type="button"
            className={PRIMARY}
            disabled={!model || remaining === 0}
            onClick={() => model && startBatch(store, { model, manifest, pages, generatorName: model.name[locale] })}
          >
            {t(resuming ? 'batchResume' : 'batchRun', { count: remaining })}
          </button>
        )}
        {status ? (
          <span role="status" className="text-gray-600 dark:text-gray-300 tabular-nums">
            {status}
            {batch && batch.failed > 0 ? ` ${t('batchFailed', { count: batch.failed })}` : ''}
          </span>
        ) : null}
      </div>
      {running ? (
        <div className="h-1.5 w-full rounded bg-gray-200 dark:bg-gray-700 overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-blue-600 transition-[width]"
            style={{ width: `${batch!.total ? Math.round((batch!.done / batch!.total) * 100) : 0}%` }}
          />
        </div>
      ) : null}
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('batchTags')}>
          <span className="text-gray-500 dark:text-gray-400 mr-1">{t('batchTags')}</span>
          {tags.map((g) => {
            const on = chosenTags.includes(g.value);
            return (
              <button
                key={g.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTag(g.value)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                  on ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: g.color }} />
                {g.value}
                <span className="tabular-nums opacity-60">{g.count}</span>
              </button>
            );
          })}
          {chosenTags.length > 0 ? (
            <button type="button" className="underline text-gray-500 dark:text-gray-400 ml-1" onClick={() => setChosenTags([])}>
              {t('batchTagsClear')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const shapeOf = (m: PageMark, i: number) => {
  // Read lines sit close together, so on a thumbnail they are lightly filled, not outlined (outlines merge into a solid block)
  const common = m.text
    ? { fill: m.color, fillOpacity: 0.3, stroke: 'none' }
    : { fill: 'none', stroke: m.color, strokeWidth: 1.5, vectorEffect: 'non-scaling-stroke' as const };
  return m.points ? (
    <polygon key={i} points={m.points.map((p) => p.join(',')).join(' ')} {...common} />
  ) : (
    <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} {...common} />
  );
};

// How the page being read and a page just read look. CSS animations only (no new dependency). The scan line
// sweeps down the thumbnail while the model reads it, and the frame pulses with a glow; when the page's result
// arrives the thumbnail flashes once and the marks fade in. With reduced motion asked for, only a still frame shows.
const READING_CSS = `
@keyframes kasane-scan-sweep {
  /* The bar is 35% of the thumbnail high and its bottom edge is the line: from -100% to 186% the line runs from the
     top of the thumbnail to its bottom, so it is in view for the whole sweep. */
  0% { transform: translateY(-100%); }
  100% { transform: translateY(186%); }
}
@keyframes kasane-scan-frame {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(34, 211, 238, 0.95), 0 0 6px 1px rgba(34, 211, 238, 0.55); }
  50% { box-shadow: inset 0 0 0 2px rgba(165, 243, 252, 1), 0 0 16px 4px rgba(34, 211, 238, 0.9); }
}
@keyframes kasane-scan-done {
  0% { opacity: 0.85; }
  100% { opacity: 0; }
}
@keyframes kasane-marks-in {
  0% { opacity: 0; transform: scale(1.06); }
  100% { opacity: 1; transform: scale(1); }
}
.kasane-scan-frame {
  box-shadow: inset 0 0 0 2px rgba(34, 211, 238, 0.95), 0 0 6px 1px rgba(34, 211, 238, 0.55);
  animation: kasane-scan-frame 1s ease-in-out infinite;
}
.kasane-scan-tint { background: rgba(8, 145, 178, 0.12); }
.kasane-scan-sweep {
  position: absolute; left: 0; right: 0; top: 0; height: 35%;
  animation: kasane-scan-sweep 1.3s cubic-bezier(0.45, 0, 0.55, 1) infinite;
  background: linear-gradient(to bottom, rgba(34, 211, 238, 0) 0%, rgba(34, 211, 238, 0.18) 60%, rgba(34, 211, 238, 0.5) 90%,
    rgba(236, 254, 255, 1) 94%, rgba(236, 254, 255, 1) 97%, rgba(34, 211, 238, 0.9) 100%);
  filter: drop-shadow(0 2px 4px rgba(34, 211, 238, 1));
}
.kasane-scan-done {
  box-shadow: inset 0 0 0 2px rgba(52, 211, 153, 1), 0 0 14px 3px rgba(52, 211, 153, 0.8);
  background: rgba(209, 250, 229, 0.35);
  animation: kasane-scan-done 900ms ease-out both;
}
.kasane-marks-in { animation: kasane-marks-in 500ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .kasane-scan-frame, .kasane-marks-in { animation: none; }
  .kasane-scan-sweep, .kasane-scan-done, .kasane-scan-tint { display: none; }
}
`;

/** The animation styles for the pages grid; render once next to the grid. */
export function PagesReadingStyle() {
  return <style>{READING_CSS}</style>;
}

/**
 * The marks of the chosen model's result over a page thumbnail. The SVG covers the thumbnail's box and fits the
 * Canvas in it the way `object-contain` fits the image, so the marks line up with the picture.
 */
export function PageThumbMarks({ page }: { page: ContainerInfo }) {
  const shown = useAtomValue(shownModelAtom);
  const batch = useAtomValue(batchStateAtom);
  const results = useAtomValue(inferenceResultsAtom);
  const chosenTags = useAtomValue(shownChosenTagsAtom);
  const result = shown ? results[resultKey(page.id, shown)] : undefined;
  const marks = marksOf(result?.page);
  const reading = useAtomValue(readingPageAtom) === page.id;
  // The page read last flashes once and its marks fade in (the animations end on their own, so nothing has to
  // remove the classes). Results already there when the grid opens, or read in the inference tab, show plainly.
  const justRead = !!result && batch?.modelId === shown && batch?.lastRead === page.id;
  // With classes chosen, every page shows only those classes (pages without them lose their marks, so the others stand out)
  const visible = useMemo(
    () => (chosenTags.length === 0 ? marks : marks.filter((m) => m.tag && chosenTags.includes(m.tag))),
    [marks, chosenTags],
  );

  return (
    <>
      {page.width && page.height && visible.length > 0 ? (
        <svg
          className={`absolute inset-0 w-full h-full p-1 pointer-events-none ${justRead ? 'kasane-marks-in' : ''}`}
          viewBox={`0 0 ${page.width} ${page.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {visible.map(shapeOf)}
        </svg>
      ) : null}
      {reading ? (
        <span aria-hidden="true" className="absolute inset-0 rounded overflow-hidden pointer-events-none kasane-scan-frame">
          <span className="absolute inset-0 kasane-scan-tint" />
          <span className="kasane-scan-sweep" />
        </span>
      ) : null}
      {justRead ? <span aria-hidden="true" className="absolute inset-0 rounded pointer-events-none kasane-scan-done" /> : null}
    </>
  );
}
