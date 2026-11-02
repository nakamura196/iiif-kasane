import {
  annotationFilterAtom,
  annotationsAtom,
  selectedAnnotationIdAtom,
  showAnnotationsAtom,
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
  creatorFacets,
  isFilterActive,
  tagFacets,
  type Facet,
} from '../../core';
import type { Annotation } from '../../core';

export default function AnnotationList() {
  const t = useTranslations('Annotation');
  const [annotations] = useAtom(annotationsAtom);
  const [visibleAnnotations] = useAtom(visibleAnnotationsAtom);
  const [filter, setFilter] = useAtom(annotationFilterAtom);
  const [selectedAnnotationId, setSelectedAnnotationId] = useAtom(selectedAnnotationIdAtom);
  const [showAnnotations, setShowAnnotations] = useAtom(showAnnotationsAtom);
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

  // 別のマニフェストを開いたら、検索・絞り込みを解除する
  useEffect(() => {
    setFilter(EMPTY_FILTER);
  }, [annotations, setFilter]);

  const creators = useMemo(() => creatorFacets(annotations), [annotations]);
  const tags = useMemo(() => tagFacets(annotations), [annotations]);

  const toggle = (facet: 'creators' | 'tags', value: string) =>
    setFilter((f) => ({
      ...f,
      [facet]: f[facet].includes(value) ? f[facet].filter((v) => v !== value) : [...f[facet], value],
    }));

  const renderFacet = (facet: 'creators' | 'tags', label: string, items: Facet[]) =>
    items.length > 0 && (
      <div className="mb-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => {
            const active = filter[facet].includes(item.value);
            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(facet, item.value)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  active
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 border-transparent text-gray-700 dark:text-gray-200 hover:border-blue-300'
                }`}
              >
                {item.value} ({item.count})
              </button>
            );
          })}
        </div>
      </div>
    );

  // 同じ場所（target.id が同じ）の注釈を 1 つの枠にまとめる
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
        {/* 3D の上に印を出すかどうか（前は 3D 表示の左上のボタン） */}
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAnnotations}
            onChange={(e) => setShowAnnotations(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          {t('showOnModel')}
        </label>
      </div>
      <input
        type="search"
        value={filter.query}
        onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        className="w-full mb-3 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
      />
      {renderFacet('creators', t('creator'), creators)}
      {renderFacet('tags', t('tags'), tags)}
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
