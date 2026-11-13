'use client';

import { useAtom, useSetAtom } from 'jotai';
import { useDeferredValue, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import {
  annotationSourcesOf,
  canvasTagFacets,
  containersOf,
  annotationsOfSelection,
  focusBoxOf,
  matchesCanvasAnnotation,
  searchTerms,
  selectedHitOf,
  selectionKeyOf,
  type RegionGroup,
  embeddedCanvasAnnotations,
  groupByRegion,
  isAnnotationAt,
  rawCanvasOf,
  labelIn,
  pickBodies,
  isResourceBody,
  narrowByKindAndUnit,
  type CanvasAnnotation,
  type StyleDeclarations,
} from '../../core';
import { useLocale, useTranslations } from '../env';
import {
  canvasAnnotationFocusOnSelectAtom,
  canvasAnnotationGranularityAtom,
  canvasAnnotationKindsAtom,
  canvasAnnotationQueryAtom,
  canvasAnnotationTagsAtom,
  selectedCanvasAnnotationAtom,
} from '../overlays/canvasAnnotationState';
import { navRequestAtom, nextSeq } from '../displays/structureState';
import { scrollRowIntoView, useVirtualRows } from '../annotation/virtualList';
import { useCanvasAnnotations } from '../overlays/useCanvasAnnotations';
import AnnotationBody from '../annotation/AnnotationBody';
import AnnotationResources from '../annotation/AnnotationResources';
import { AnnotationCardFrame, RegionGroupFrame } from '../annotation/AnnotationCardFrame';
import { FilterChips } from '../annotation/FilterChips';
import { ShowMarksToggle } from '../annotation/ShowMarksToggle';
import { useGranularityLabel, useKindLabel, useKindOptions } from '../annotation/kindLabels';
import { annotationNumbers } from '../overlays/annotationMarks';
import { fmt } from '../displays/TranscriptPanel';
import { usePlayback } from '../playback';
import type { Panel, PanelContext } from './types';

// Show tag chips up to this number, most frequent first (the rest open with "Show all"), so tags with scattered values do not fill the panel
const TAG_LIMIT = 20;

function Item({
  annotation,
  number,
  selected,
  onSelect,
  canvasLabels,
  bodyStyle,
  playing,
}: {
  bodyStyle?: StyleDeclarations;
  annotation: CanvasAnnotation;
  /** The same number as the annotation's mark on the image. */
  number?: number;
  selected: boolean;
  /** The annotation's time contains the current position of the video or audio. */
  playing?: boolean;
  onSelect: () => void;
  canvasLabels: Map<string, string>;
}) {
  const t = useTranslations('Info');
  const locale = useLocale();
  const bodies = pickBodies(annotation.bodies, locale).filter((b) => !isResourceBody(b));
  const kindLabel = useKindLabel();
  const granularityLabel = useGranularityLabel();
  const motivation = annotation.painted ? 'painting' : annotation.motivations[0];
  // Do not label "comment" (the default purpose) or "region" for annotations with a frame, because the numbered chip corresponds to the frame on the image
  const notes: string[] = [];
  if (motivation && motivation !== 'commenting')
    notes.push(kindLabel(motivation));
  if (annotation.region.type === 'canvas') notes.push(t('canvasAnnotationsAbout'));
  if (annotation.granularity) notes.push(granularityLabel(annotation.granularity));
  if (annotation.layer)
    notes.push(t('canvasAnnotationsLayer', { label: labelIn(annotation.layer.label, locale) || annotation.layer.id }));
  if (annotation.time)
    notes.push(
      fmt(annotation.time.start) +
        (annotation.time.end !== undefined && fmt(annotation.time.end) !== fmt(annotation.time.start)
          ? `–${fmt(annotation.time.end)}`
          : ''),
    );
  return (
    <AnnotationCardFrame
      number={number}
      title={labelIn(annotation.title, locale) || undefined}
      meta={notes.length > 0 ? notes.map((n, i) => <span key={i} className="tabular-nums">{n}</span>) : undefined}
      selected={selected}
      playing={playing}
      onSelect={onSelect}
      annotationId={annotation.id}
      bodyStyle={bodyStyle}
      bodyClassName={bodyStyle?.color ? '[&_*]:!text-inherit' : ''}
    >
      {bodies.map((b, i) => (
        <AnnotationBody key={i} body={b} canvasLabels={canvasLabels} />
      ))}
      <AnnotationResources resources={annotation.resources} />
    </AnnotationCardFrame>
  );
}

// One list row: a heading for a group of annotations (AnnotationCollection) or an annotation (those with the same region share one row)
type Row =
  | { kind: 'header'; key: string; label: unknown; fallback: string; count: number }
  | { kind: 'item'; key: string; group: RegionGroup<CanvasAnnotation> };

// Top padding of the list (same value as padding-top of the scrolling frame)
const LIST_TOP = 8;

export function CanvasAnnotationsPanelBody({ container, manifest }: PanelContext) {
  const t = useTranslations('Info');
  const tf = useTranslations('AnnotationFilter');
  const locale = useLocale();
  const { annotations: all, loading, failed, styleOf } = useCanvasAnnotations(manifest, container);
  // the same numbers as the marks on the image (none when there are very many)
  const numbers = useMemo(() => annotationNumbers(all), [all]);
  const [selected, setSelected] = useAtom(selectedCanvasAnnotationAtom);
  // the same rule as the marks on the image: all the marks of a search hit are selected together
  const selectedHit = useMemo(() => selectedHitOf(selected, all), [selected, all]);
  // Text Granularity: allow filtering by unit, e.g. when both lines and words exist
  const [granularity, setGranularity] = useAtom(canvasAnnotationGranularityAtom);
  const [query, setQuery] = useAtom(canvasAnnotationQueryAtom);
  const [focusOnSelect, setFocusOnSelect] = useAtom(canvasAnnotationFocusOnSelectAtom);
  const [chosenTags, setChosenTags] = useAtom(canvasAnnotationTagsAtom);
  const [chosenKinds, setChosenKinds] = useAtom(canvasAnnotationKindsAtom);
  const setRequest = useSetAtom(navRequestAtom);
  // While typing, update the input first and let the list filtering catch up later
  const deferredQuery = useDeferredValue(query);
  // Kind (motivation) first, then the unit of text: the same narrowing as the marks over the image
  const { kindFacets, granularities, activeGranularity, narrowing, annotations } = useMemo(
    () => narrowByKindAndUnit(all, chosenKinds, granularity),
    [all, chosenKinds, granularity],
  );
  const kindOptions = useKindOptions(kindFacets);
  const granularityLabel = useGranularityLabel();
  const terms = useMemo(() => searchTerms(deferredQuery), [deferredQuery]);
  // Tag chips ("key: value"). Counts are by number of locations, like the list rows
  const tagFacets = useMemo(() => canvasTagFacets(groupByRegion(annotations), locale), [annotations, locale]);
  // Filter only by selected tags that exist in the current Canvas and unit (so a missing tag does not empty the list)
  const tags = useMemo(
    () => chosenTags.filter((v) => tagFacets.some((f) => f.value === v)),
    [chosenTags, tagFacets],
  );
  const filtering = terms.length > 0 || tags.length > 0;
  const { currentTime, seek } = usePlayback();
  const timed = annotations.some((a) => a.time);

  // clear the selection when the Canvas changes
  useEffect(() => {
    setSelected(null);
  }, [container?.id, setSelected]);

  const canvasLabels = useMemo(() => {
    const m = new Map<string, string>();
    containersOf(manifest).forEach((c, i) => m.set(c.id, labelIn(c.label, locale) || `Canvas ${i + 1}`));
    return m;
  }, [manifest, locale]);

  // group by AnnotationCollection (annotations of no collection come first), then by region;
  // a region is kept when one of its annotations has all the words of the search (and one of the chosen tags)
  const { rows, shown } = useMemo(() => {
    const groups = new Map<string, { label: unknown; items: CanvasAnnotation[] }>();
    for (const a of annotations) {
      const key = a.collection?.id ?? '';
      const g = groups.get(key) ?? { label: a.collection?.label, items: [] };
      g.items.push(a);
      groups.set(key, g);
    }
    const ordered = [...groups.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : 0));
    const out: Row[] = [];
    let count = 0;
    for (const [key, g] of ordered) {
      const regions = groupByRegion(g.items).filter(
        (rg) => !filtering || rg.annotations.some((a) => matchesCanvasAnnotation(a, terms, tags, locale)),
      );
      if (regions.length === 0) continue;
      if (key) out.push({ kind: 'header', key: `h:${key}`, label: g.label, fallback: key, count: regions.length });
      for (const rg of regions) out.push({ kind: 'item', key: `${key}|${rg.key}`, group: rg });
      count += regions.length;
    }
    return { rows: out, shown: count };
  }, [annotations, filtering, terms, tags, locale]);
  // out of all the places on the Canvas, so that a kind or a unit chosen shows as "N of M"
  const total = useMemo(
    () => (filtering || narrowing ? groupByRegion(all).length : shown),
    [all, filtering, narrowing, shown],
  );

  const scroller = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => rows.map((r) => r.key), [rows]);
  const list = useVirtualRows(scroller, keys, { listTop: LIST_TOP });

  // a mark chosen on the image (or elsewhere): bring its row into view
  const rowOf = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => {
      if (r.kind !== 'item') return;
      // keyed by what selection compares on: the first row (in list order) of a search hit's marks
      for (const a of r.group.annotations) if (!m.has(selectionKeyOf(a))) m.set(selectionKeyOf(a), i);
    });
    return m;
  }, [rows]);
  const showRow = useEffectEvent((id: string) => {
    const i = rowOf.get(id);
    if (i !== undefined) scrollRowIntoView(scroller.current, list.offsets, i, LIST_TOP);
  });
  useEffect(() => {
    if (!selectedHit) return;
    showRow(selectedHit);
    // once more after the rows drawn there are measured (their heights were estimated)
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => showRow(selectedHit));
    });
    return () => cancelAnimationFrame(id);
  }, [selectedHit]);

  const choose = (a: CanvasAnnotation, isSelected: boolean) => {
    // an annotation on a moment of a video or audio: go there, so that its frame is shown
    // (a little past the start: a seek may land a hair before the asked position)
    if (a.time && !isSelected) seek(a.time.start + 0.01);
    if (focusOnSelect && !isSelected && container) {
      // all the marks of a search hit (one annotation otherwise), so that every word of the hit is in view
      const box = focusBoxOf(
        annotationsOfSelection(all, selectionKeyOf(a)).map((m) => m.region),
        { width: container.width ?? 0, height: container.height ?? 0 },
      );
      // the chosen annotation is marked on the image already: no second box around the wider part shown
      if (box) setRequest({ seq: nextSeq(), target: { canvasId: container.id, xywh: box }, highlight: false });
    }
    setSelected(isSelected ? null : selectionKeyOf(a));
  };

  const searching = query.trim().length > 0 || tags.length > 0 || narrowing;

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="p-3 pb-2 space-y-2 border-b border-gray-200 dark:border-gray-700">
        {loading ? <p className="text-sm text-gray-500 dark:text-gray-300">{t('canvasAnnotationsLoading')}</p> : null}
        {failed ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {t('canvasAnnotationsFailed')}
          </p>
        ) : null}
        {all.length > 0 ? (
          <div className="flex items-center gap-1">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('canvasAnnotationsSearch')}
              aria-label={t('canvasAnnotationsSearch')}
              className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm text-gray-800 dark:text-gray-100"
            />
          </div>
        ) : null}
        {all.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-300">
            <span aria-live="polite">
              {searching
                ? t('canvasAnnotationsSearchCount', { count: shown, total })
                : t('canvasAnnotationsTotal', { count: shown })}
            </span>
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              <ShowMarksToggle />
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={focusOnSelect} onChange={(e) => setFocusOnSelect(e.target.checked)} />
                {t('canvasAnnotationsFocusOnSelect')}
              </label>
            </span>
          </div>
        ) : null}
        <FilterChips
          label={tf('kind')}
          options={kindOptions}
          chosen={chosenKinds}
          onChange={setChosenKinds}
          minOptions={2}
        />
        <FilterChips
          label={tf('granularity')}
          options={granularities.map((g) => ({ value: g, label: granularityLabel(g) }))}
          chosen={activeGranularity ? [activeGranularity] : []}
          onChange={(next) => setGranularity(next[0] ?? null)}
          multiple={false}
          minOptions={2}
        />
        <FilterChips
          label={tf('tags')}
          options={tagFacets}
          chosen={tags}
          onChange={setChosenTags}
          limit={TAG_LIMIT}
        />
        {!loading && annotations.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-300">{t('canvasAnnotationsEmpty')}</p>
        ) : null}
        {annotations.length > 0 && rows.length === 0 && filtering ? (
          <p className="text-sm text-gray-500 dark:text-gray-300">{t('canvasAnnotationsNoMatch')}</p>
        ) : null}
      </div>
      {/* Render only the visible rows and their neighbors (so tens of thousands of annotations stay light) */}
      <div
        ref={scroller}
        className="flex-1 min-h-0 overflow-auto px-3 pb-3 [overflow-anchor:none]"
        style={{ paddingTop: LIST_TOP }}
        data-annotation-list
      >
        <div className="relative" style={{ height: list.offsets[list.offsets.length - 1] }}>
          <div className="absolute inset-x-0" style={{ top: list.offsets[list.start] }}>
            {rows.slice(list.start, list.end).map((r, j) => (
              <div key={r.key} ref={list.measure} data-key={r.key} data-top={list.offsets[list.start + j]} className="pb-2">
                {r.kind === 'header' ? (
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 pt-1">
                    <LabelOf label={r.label} fallback={r.fallback} /> ({t('canvasAnnotationsCount', { count: r.count })})
                  </h3>
                ) : (
                  (() => {
                    const rg = r.group;
                    const card = (a: CanvasAnnotation) => {
                      const isSelected = selectedHit !== null && selectionKeyOf(a) === selectedHit;
                      return (
                        <Item
                          key={a.id}
                          annotation={a}
                          number={numbers?.get(a.id)}
                          selected={isSelected}
                          onSelect={() => choose(a, isSelected)}
                          playing={timed && !!a.time && isAnnotationAt(a, currentTime)}
                          canvasLabels={canvasLabels}
                          bodyStyle={styleOf(a).body}
                        />
                      );
                    };
                    return rg.annotations.length > 1 ? (
                      <RegionGroupFrame count={rg.annotations.length}>{rg.annotations.map(card)}</RegionGroupFrame>
                    ) : (
                      card(rg.annotations[0])
                    );
                  })()
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LabelOf({ label, fallback }: { label: unknown; fallback: string }) {
  const locale = useLocale();
  return <>{labelIn(label, locale) || fallback}</>;
}

// List of annotations on the Canvas (comments, tags, links, etc.). Not shown for 3D Scenes.
export const canvasAnnotationsPanel: Panel = {
  id: 'canvasAnnotations',

  order: 80,
  // Show only when there are written annotations, references to fetch, or local annotations (e.g. inference results) overlaid on this page's image
  available: ({ container, manifest, containerLocalAnnotationCount }) => {
    if (container?.kind !== 'Canvas') return false;
    if ((containerLocalAnnotationCount ?? 0) > 0) return true;
    if (annotationSourcesOf(rawCanvasOf(manifest, container.id)).references.length > 0) return true;
    return embeddedCanvasAnnotations(manifest, container.id, container).length > 0;
  },
  Component: CanvasAnnotationsPanelBody,
};
