import {
  annotationFilterAtom,
  annotationsAtom,
  selectedAnnotationIdAtom,
  visibleAnnotationsAtom,
} from '../atoms';
import { useAtom } from 'jotai';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslations } from '../env';
import AnnotationCard from '../annotation/AnnotationCard';
import { RegionGroupFrame } from '../annotation/AnnotationCardFrame';
import { groupByRegion } from '../../core';
import {
  EMPTY_FILTER,
  annotationKindFacets,
  creatorFacets,
  isFilterActive,
  tagFacets,
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

  // Opening another manifest clears the search and the filters
  useEffect(() => {
    setFilter(EMPTY_FILTER);
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

  return (
    <div className="p-6 bg-white dark:bg-gray-900">
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
