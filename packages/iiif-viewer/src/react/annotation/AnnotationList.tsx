import {
  annotationFilterAtom,
  annotationsAtom,
  manifestAtom,
  selectedAnnotationIdAtom,
  visibleAnnotationsAtom,
} from '../atoms';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useContentLocale, useTranslations } from '../env';
import AnnotationCard, { AnnotationCardDetail } from '../annotation/AnnotationCard';
import { RegionGroupFrame } from '../annotation/AnnotationCardFrame';
import { buildAnnotationGraph, groupByRegion, labelIn, opensDetail } from '../../core';
import {
  EMPTY_FILTER,
  annotationKindFacets,
  creatorFacets,
  isFilterActive,
  tagFacets,
  tagKey,
} from '../../core';
import { FilterChips } from './FilterChips';
import { ShowMarksToggle } from './ShowMarksToggle';
import { useKindOptions } from './kindLabels';
import type { Annotation } from '../../core';

export default function AnnotationList() {
  const t = useTranslations('Annotation');
  const tf = useTranslations('AnnotationFilter');
  const [annotations] = useAtom(annotationsAtom);
  const [visibleAnnotations] = useAtom(visibleAnnotationsAtom);
  const [filter, setFilter] = useAtom(annotationFilterAtom);
  const [selectedAnnotationId, setSelectedAnnotationId] = useAtom(selectedAnnotationIdAtom);
  const [manifest] = useAtom(manifestAtom);
  const locale = useContentLocale();
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedAnnotationId && selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [selectedAnnotationId]);

  const focusOnAnnotation = (annotationId: string) => {
    setSelectedAnnotationId(annotationId);
  };

  // Opening another manifest (other annotations) clears the search and the filters. The same annotations read in
  // another content language keep them, except the tags that no longer exist (tag keys follow the language).
  const idsKey = useMemo(() => annotations.map((a) => a.id).join('\n'), [annotations]);
  useEffect(() => {
    setFilter(EMPTY_FILTER);
  }, [idsKey, setFilter]);
  useEffect(() => {
    const present = new Set(annotations.flatMap((a) => (a.tags ?? []).map(tagKey)));
    setFilter((f) => (f.tags.every((k) => present.has(k)) ? f : { ...f, tags: f.tags.filter((k) => present.has(k)) }));
  }, [annotations, setFilter]);

  const creators = useMemo(() => creatorFacets(annotations), [annotations]);
  const tags = useMemo(() => tagFacets(annotations), [annotations]);

  const kindOptions = useKindOptions(useMemo(() => annotationKindFacets(annotations), [annotations]));
  const setFacet = (facet: 'creators' | 'tags' | 'kinds') => (next: string[]) => setFilter((f) => ({ ...f, [facet]: next }));

  // Annotations on the same place (the same target.id) go in one frame
  const regionGroups = useMemo(() => groupByRegion(visibleAnnotations), [visibleAnnotations]);
  const numberOf = useMemo(
    () => new Map(annotations.map((a, i) => [a.id, i + 1])),
    [annotations],
  );

  // An annotation with connections opens in a detail view in place of the list
  const detail = useMemo(() => {
    const a = selectedAnnotationId ? annotations.find((x) => x.id === selectedAnnotationId) : undefined;
    return a && opensDetail({ id: a.id, regionId: a.regionId, resources: a.resources }) ? a : undefined;
  }, [annotations, selectedAnnotationId]);
  // The connections of every annotation (not only the ones the filter leaves); built only while a detail view is open
  const opened = !!detail;
  const graph = useMemo(
    () =>
      opened
        ? buildAnnotationGraph(
            annotations.map((a) => ({
              id: a.id,
              label: a.data.body.label,
              number: numberOf.get(a.id),
              regionId: a.regionId,
              resources: a.resources,
            })),
            manifest ? { id: manifest.id, label: labelIn(manifest.label, locale) || undefined } : undefined,
            locale,
          )
        : undefined,
    [opened, annotations, numberOf, manifest, locale],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);
  const back = useCallback(() => {
    returnTo.current = selectedAnnotationId;
    setSelectedAnnotationId(null);
  }, [selectedAnnotationId, setSelectedAnnotationId]);
  // Back: scroll the list to the card the detail view was about
  useEffect(() => {
    const id = returnTo.current;
    if (detail || !id) return;
    returnTo.current = null;
    const card = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-annotation-id]') ?? [])].find(
      (el) => el.dataset.annotationId === id,
    );
    card?.scrollIntoView({ block: 'center' });
  }, [detail]);

  const renderCard = (annotation: Annotation) => (
    <AnnotationCard
      key={annotation.id}
      annotation={annotation}
      number={numberOf.get(annotation.id)}
      selected={selectedAnnotationId === annotation.id}
      onSelect={focusOnAnnotation}
      cardRef={selectedAnnotationId === annotation.id ? selectedRef : undefined}
    />
  );

  if (detail && graph) {
    return (
      <div className="p-6 bg-white dark:bg-gray-900">
        <AnnotationCardDetail
          annotation={detail}
          number={numberOf.get(detail.id)}
          graph={graph}
          onBack={back}
          onSelectAnnotation={focusOnAnnotation}
        />
      </div>
    );
  }

  return (
    <div ref={listRef} className="p-6 bg-white dark:bg-gray-900">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('annotations')}</h2>
        {/* Whether the marks are drawn over the model (the same switch as over images and page thumbnails) */}
        <ShowMarksToggle className="text-sm" />
      </div>
      <input
        type="search"
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        className="w-full mb-3 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
      />
      <div className="mb-3 space-y-2">
        <FilterChips label={tf('kind')} options={kindOptions} chosen={filter.kinds ?? []} onChange={setFacet('kinds')} minOptions={2} />
        <FilterChips label={t('creator')} options={creators} chosen={filter.creators} onChange={setFacet('creators')} />
        <FilterChips label={t('tags')} options={tags} chosen={filter.tags} onChange={setFacet('tags')} />
      </div>
      <div className="mb-4 flex items-center gap-3 text-gray-500 dark:text-gray-400">
        {isFilterActive(filter)
          ? t('filteredCount', { shown: visibleAnnotations.length, total: annotations.length })
          : t('annotationCount', { count: annotations.length })}
        {isFilterActive(filter) && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="text-xs text-[var(--ds-primary)] hover:underline"
          >
            {t('clearFilter')}
          </button>
        )}
      </div>
      <div className="space-y-4">
        {regionGroups.map((group) =>
          group.annotations.length > 1 ? (
            <RegionGroupFrame key={group.key} count={group.annotations.length}>
              {group.annotations.map(renderCard)}
            </RegionGroupFrame>
          ) : (
            renderCard(group.annotations[0])
          ),
        )}
      </div>
    </div>
  );
}
