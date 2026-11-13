'use client';

// The names of the kinds of annotation (motivations) and of the units of text (Text Granularity), in the reader's
// language. The 2D cards, and the kind and unit filters of every list, use the same names.

import { useCallback } from 'react';
import { TEXT_GRANULARITIES, type Facet } from '../../core';
import { useTranslations } from '../env';
import type { FilterOption } from './FilterChips';

/** Motivations that have a name in the messages (Info.canvasAnnotationsMotivation_*). */
export const KNOWN_MOTIVATIONS: ReadonlySet<string> = new Set([
  'supplementing', 'commenting', 'tagging', 'linking', 'describing', 'identifying', 'classifying',
  'bookmarking', 'highlighting', 'questioning', 'replying', 'editing', 'moderating', 'painting',
]);

export const isKnownGranularity = (g: string) => (TEXT_GRANULARITIES as readonly string[]).includes(g);

export function useKindLabel(): (kind: string) => string {
  const t = useTranslations('Info');
  return useCallback(
    (kind: string) => (KNOWN_MOTIVATIONS.has(kind) ? t(`canvasAnnotationsMotivation_${kind}`) : kind),
    [t],
  );
}

export function useGranularityLabel(): (g: string) => string {
  const t = useTranslations('Info');
  return useCallback((g: string) => (isKnownGranularity(g) ? t(`canvasAnnotationsGranularity_${g}`) : g), [t]);
}

/** The kind facets as filter options, with their names. */
export function useKindOptions(facets: readonly Facet[]): FilterOption[] {
  const label = useKindLabel();
  return facets.map((f) => ({ value: f.value, count: f.count, label: label(f.value) }));
}
