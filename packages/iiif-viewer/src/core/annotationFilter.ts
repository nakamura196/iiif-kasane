// Text search and creator / tag facets for the annotation list.
// Within one facet the selected values are OR-ed; across facets (and with the
// text query) they are AND-ed. The text is matched as in the 2D list (core/features/annotationSearch.ts):
// the width of characters and case do not matter, and every word must be found.

import {
  cachedSearchText,
  htmlSearchText,
  labelStrings,
  matchesSearchTerms,
  searchTerms,
} from './features/annotationSearch';
import type { Annotation, AnnotationTag } from './types/main';

export interface AnnotationFilter {
  query: string;
  creators: string[];
  // Tag keys as produced by tagKey().
  tags: string[];
}

export const EMPTY_FILTER: AnnotationFilter = { query: '', creators: [], tags: [] };

export const isFilterActive = (f: AnnotationFilter): boolean =>
  f.query.trim() !== '' || f.creators.length > 0 || f.tags.length > 0;

export const tagKey = (tag: AnnotationTag): string =>
  tag.key ? `${tag.key}: ${tag.value}` : tag.value;

// What the card shows: heading, description, creator, tags, pictures and related links.
export const annotationListSearchText = (a: Annotation): string =>
  cachedSearchText(a, () => [
    a.title,
    htmlSearchText(a.description),
    a.creator,
    ...(a.tags ?? []).map(tagKey),
    ...(a.images ?? []).flatMap((i) => [i.id, ...labelStrings(i.label)]),
    ...(a.seeAlso ?? []).flatMap((l) => [l.id, ...labelStrings(l.label)]),
  ]);

export const filterAnnotations = (
  annotations: Annotation[],
  filter: AnnotationFilter,
): Annotation[] => {
  const terms = searchTerms(filter.query);
  return annotations.filter((a) => {
    if (filter.creators.length > 0 && !filter.creators.includes(a.creator)) return false;
    if (filter.tags.length > 0 && !(a.tags ?? []).some((t) => filter.tags.includes(tagKey(t)))) {
      return false;
    }
    return terms.length === 0 || matchesSearchTerms(annotationListSearchText(a), terms);
  });
};

export interface Facet {
  value: string;
  count: number;
}

const countBy = (values: string[]): Facet[] => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count }));
};

export const creatorFacets = (annotations: Annotation[]): Facet[] =>
  countBy(annotations.map((a) => a.creator).filter(Boolean));

export const tagFacets = (annotations: Annotation[]): Facet[] =>
  countBy(annotations.flatMap((a) => (a.tags ?? []).map(tagKey)));
