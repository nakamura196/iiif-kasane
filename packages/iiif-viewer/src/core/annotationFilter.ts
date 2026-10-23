// Text search and creator / tag facets for the annotation list.
// Within one facet the selected values are OR-ed; across facets (and with the
// text query) they are AND-ed. The text is matched as in the 2D list (core/features/annotationSearch.ts):
// the width of characters and case do not matter, and every word must be found.

import { otherBodies } from './features/annotationBody';
import {
  bodySearchParts,
  cachedSearchText,
  countBy,
  htmlSearchText,
  labelStrings,
  matchesSearchTerms,
  searchTerms,
  tagKey,
  type Facet,
} from './features/annotationSearch';
import type { Annotation } from './types/main';

// tagKey and Facet are shared with the 2D list; they are still exported from here for older imports.
export { tagKey, type Facet };

export interface AnnotationFilter {
  query: string;
  creators: string[];
  // Tag keys as produced by tagKey().
  tags: string[];
}

export const EMPTY_FILTER: AnnotationFilter = { query: '', creators: [], tags: [] };

export const isFilterActive = (f: AnnotationFilter): boolean =>
  f.query.trim() !== '' || f.creators.length > 0 || f.tags.length > 0;

// What the card shows: heading, description and the other bodies, creator, tags, pictures and related links.
export const annotationListSearchText = (a: Annotation): string =>
  cachedSearchText(a, () => [
    a.title,
    htmlSearchText(a.description),
    ...otherBodies(a.bodies ?? []).flatMap((b) => bodySearchParts(b, true)),
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

export const creatorFacets = (annotations: Annotation[]): Facet[] =>
  countBy(annotations.map((a) => a.creator).filter(Boolean));

export const tagFacets = (annotations: Annotation[]): Facet[] =>
  countBy(annotations.flatMap((a) => (a.tags ?? []).map(tagKey)));
